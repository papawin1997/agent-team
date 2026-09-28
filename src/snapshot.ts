import { execFile } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** การเปลี่ยนแปลงของรอบหนึ่ง (ระหว่าง snapshot ก่อนและหลัง worker) ที่ส่งให้ QA */
export interface RoundDiff {
  /** unified diff (อาจถูกตัดที่ maxChars) */
  diff: string;
  /** ไฟล์ที่เปลี่ยนทั้งหมด (ไม่ถูกตัด) */
  files: string[];
  truncated: boolean;
}

/** ถ่าย snapshot ของ working tree เพื่อหา diff ของรอบแก้ (ฉีดผ่าน Deps.snapshots เทสต์ใช้ตัวปลอมได้) */
export interface SnapshotProvider {
  /** undefined = ทำ snapshot ไม่ได้ (ไม่ใช่ git repo / ไม่มี git) */
  snapshot(): Promise<string | undefined>;
  diff(before: string, after: string): Promise<RoundDiff>;
}

export const MAX_DIFF_CHARS = 60_000;

/** โฟลเดอร์ state ของ agent-team ไม่ใช่งานของ worker */
const EXCLUDE_AGENT_TEAM = ':(exclude).agent-team';

async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/**
 * snapshot = tree hash ของ working tree ทั้งหมด (รวมไฟล์ที่ยังไม่ track แต่เคารพ .gitignore)
 * ใช้ index ชั่วคราว (GIT_INDEX_FILE) จึงไม่แตะ index/branch/stash ของผู้ใช้ — เขียนแค่ object ลง .git/objects
 */
export class GitSnapshots implements SnapshotProvider {
  constructor(
    private readonly projectDir: string,
    private readonly maxChars: number = MAX_DIFF_CHARS,
  ) {}

  async snapshot(): Promise<string | undefined> {
    try {
      if ((await git(this.projectDir, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return undefined;
    } catch {
      return undefined;
    }
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-team-index-'));
    const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
    try {
      try {
        // เริ่มจาก HEAD ให้ git add ทำงานเร็ว (เทียบกับ stat เดิม) repo ที่ยังไม่มี commit เริ่มจาก index ว่าง
        await git(this.projectDir, ['read-tree', 'HEAD'], env);
      } catch {
        // ยังไม่มี commit
      }
      await git(this.projectDir, ['add', '-A', '--', '.', EXCLUDE_AGENT_TEAM], env);
      return (await git(this.projectDir, ['write-tree'], env)).trim();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  }

  async diff(before: string, after: string): Promise<RoundDiff> {
    const names = await git(this.projectDir, ['diff', '--name-only', before, after]);
    const files = names
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const full = await git(this.projectDir, ['diff', '--no-color', '--no-ext-diff', before, after]);
    const truncated = full.length > this.maxChars;
    return { diff: truncated ? full.slice(0, this.maxChars) : full, files, truncated };
  }
}
