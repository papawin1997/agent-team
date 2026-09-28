import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { GitSnapshots } from '../src/snapshot';

let dir: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text, 'utf8');
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-snap-'));
});

function initRepo(): void {
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  write('src/a.ts', 'export const a = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
}

describe('GitSnapshots', () => {
  it('ไม่ใช่ git repo → snapshot คืน undefined', async () => {
    expect(await new GitSnapshots(dir).snapshot()).toBeUndefined();
  });

  it('diff ระหว่าง snapshot เห็นไฟล์ที่แก้และไฟล์ใหม่ที่ยังไม่ track แต่ไม่เห็น .agent-team', async () => {
    initRepo();
    const snaps = new GitSnapshots(dir);
    const before = await snaps.snapshot();
    expect(before).toMatch(/^[0-9a-f]{40,64}$/);

    write('src/a.ts', 'export const a = 2;\n');
    write('src/new.ts', 'export const b = 1;\n');
    write('.agent-team/jobs/x/state.json', '{}');
    const after = (await snaps.snapshot())!;

    const result = await snaps.diff(before!, after);
    expect(result.files.sort()).toEqual(['src/a.ts', 'src/new.ts']);
    expect(result.diff).toContain('-export const a = 1;');
    expect(result.diff).toContain('+export const a = 2;');
    expect(result.diff).toContain('+export const b = 1;');
    expect(result.truncated).toBe(false);
  });

  it('ไม่แตะ index ของผู้ใช้ (ไฟล์ที่ stage ไว้ยังเหมือนเดิม และไฟล์ใหม่ยังไม่ถูก stage)', async () => {
    initRepo();
    write('src/staged.ts', 'x\n');
    git('add', 'src/staged.ts');
    write('src/untracked.ts', 'y\n');
    const statusBefore = git('status', '--porcelain');
    await new GitSnapshots(dir).snapshot();
    expect(git('status', '--porcelain')).toBe(statusBefore);
  });

  it('ไม่มีอะไรเปลี่ยน → diff ว่าง', async () => {
    initRepo();
    const snaps = new GitSnapshots(dir);
    const a = (await snaps.snapshot())!;
    const b = (await snaps.snapshot())!;
    expect(a).toBe(b);
    expect(await snaps.diff(a, b)).toEqual({ diff: '', files: [], truncated: false });
  });

  it('repo ที่ยังไม่มี commit ก็ snapshot ได้', async () => {
    git('init', '-q');
    write('a.txt', 'hi\n');
    expect(await new GitSnapshots(dir).snapshot()).toMatch(/^[0-9a-f]{40,64}$/);
  });

  it('diff ยาวเกิน maxChars → ตัดและบอก truncated แต่ files ครบ', async () => {
    initRepo();
    const snaps = new GitSnapshots(dir, 200);
    const before = (await snaps.snapshot())!;
    write('src/big.ts', 'x'.repeat(5000) + '\n');
    const result = await snaps.diff(before, (await snaps.snapshot())!);
    expect(result.truncated).toBe(true);
    expect(result.diff.length).toBe(200);
    expect(result.files).toEqual(['src/big.ts']);
  });
});
