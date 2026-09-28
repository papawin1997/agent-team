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

/** lockfile: ยังอยู่ใน files แต่ตัดออกจากเนื้อ diff (ยาวและไม่ช่วยการรีวิว) */
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'poetry.lock', 'go.sum'];
const EXCLUDE_LOCKFILES = LOCKFILES.map((name) => `:(exclude,glob)**/${name}`);

/** path relative กับโฟลเดอร์โปรเจกต์ (โปรเจกต์อยู่ใน subfolder ของ repo ได้) และไม่ escape ชื่อไฟล์ที่ไม่ใช่ ASCII */
const DIFF_ARGS = ['-c', 'core.quotePath=false', 'diff', '--relative'];

async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** ตัด string ที่ maxChars โดยไม่ผ่ากลาง surrogate pair (emoji ฯลฯ) */
function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  const last = text.charCodeAt(maxChars - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? maxChars - 1 : maxChars);
}

/**
 * snapshot = tree hash ของ working tree ทั้งหมด (รวมไฟล์ที่ยังไม่ track แต่เคารพ .gitignore)
 * ใช้ index ชั่วคราว (GIT_INDEX_FILE ที่ copy มาจาก index จริง) จึงไม่แตะ index/branch/stash ของผู้ใช้ — เขียนแค่ object ลง .git/objects
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
    const tmpIndex = path.join(tmp, 'index');
    const env = { GIT_INDEX_FILE: tmpIndex };
    try {
      await this.seedIndex(tmpIndex, env);
      await git(this.projectDir, ['add', '-A', '--', '.', EXCLUDE_AGENT_TEAM], env);
      return (await git(this.projectDir, ['write-tree'], env)).trim();
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  }

  /**
   * เริ่ม index ชั่วคราวจากสำเนาของ index จริง เพื่อให้ git add -A ใช้ stat เดิมได้ (ไม่ต้อง hash ทุกไฟล์ใหม่)
   * — copy อย่างเดียว ไม่เขียนกลับ index จริง; copy ไม่ได้ (เช่นไม่มีไฟล์ index) ใช้ HEAD, ยังไม่มี commit ใช้ index ว่าง
   */
  private async seedIndex(tmpIndex: string, env: Record<string, string>): Promise<void> {
    try {
      const gitPath = (await git(this.projectDir, ['rev-parse', '--git-path', 'index'])).trim();
      await fsp.copyFile(path.resolve(this.projectDir, gitPath), tmpIndex);
      return;
    } catch {
      // ไม่มี index จริง: ลอง HEAD
    }
    try {
      await git(this.projectDir, ['read-tree', 'HEAD'], env);
    } catch {
      // ยังไม่มี commit: เริ่มจาก index ว่าง
    }
  }

  async diff(before: string, after: string): Promise<RoundDiff> {
    const names = await git(this.projectDir, [...DIFF_ARGS, '--name-only', before, after]);
    const files = names
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const full = await git(this.projectDir, [
      ...DIFF_ARGS,
      '--no-color',
      '--no-ext-diff',
      before,
      after,
      '--',
      '.',
      ...EXCLUDE_LOCKFILES,
    ]);
    const truncated = full.length > this.maxChars;
    return { diff: truncated ? truncate(full, this.maxChars) : full, files, truncated };
  }
}
