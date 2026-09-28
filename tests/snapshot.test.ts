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

  it('โปรเจกต์อยู่ใน subfolder ของ repo → path ใน files และ diff เป็นแบบ relative กับโปรเจกต์', async () => {
    initRepo();
    write('sub/a.txt', 'one\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'sub');
    const snaps = new GitSnapshots(path.join(dir, 'sub'));
    const before = (await snaps.snapshot())!;
    write('sub/a.txt', 'two\n');
    const result = await snaps.diff(before, (await snaps.snapshot())!);
    expect(result.files).toEqual(['a.txt']);
    expect(result.diff).toContain('a/a.txt');
    expect(result.diff).not.toContain('sub/a.txt');
  });

  it('ชื่อไฟล์ภาษาไทยไม่ถูก quote/escape', async () => {
    initRepo();
    const snaps = new GitSnapshots(dir);
    const before = (await snaps.snapshot())!;
    write('src/ไฟล์.ts', 'x\n');
    const result = await snaps.diff(before, (await snaps.snapshot())!);
    expect(result.files).toEqual(['src/ไฟล์.ts']);
    expect(result.diff).toContain('b/src/ไฟล์.ts');
  });

  it('lockfile อยู่ใน files แต่ไม่อยู่ในเนื้อ diff', async () => {
    initRepo();
    const snaps = new GitSnapshots(dir);
    const before = (await snaps.snapshot())!;
    write('package-lock.json', '{"lock":true}\n');
    write('pkg/yarn.lock', 'lock\n');
    write('src/a.ts', 'export const a = 3;\n');
    const result = await snaps.diff(before, (await snaps.snapshot())!);
    expect(result.files.sort()).toEqual(['package-lock.json', 'pkg/yarn.lock', 'src/a.ts']);
    expect(result.diff).toContain('+export const a = 3;');
    expect(result.diff).not.toContain('package-lock.json');
    expect(result.diff).not.toContain('yarn.lock');
  });

  it('ไม่มีไฟล์ index (ลบทิ้ง) ก็ยัง snapshot/diff ได้ และไม่สร้าง index ของผู้ใช้ขึ้นมา', async () => {
    initRepo();
    const snaps = new GitSnapshots(dir);
    const before = (await snaps.snapshot())!;
    fs.rmSync(path.join(dir, '.git', 'index'));
    write('src/a.ts', 'export const a = 9;\n');
    const after = await snaps.snapshot();
    expect(after).toMatch(/^[0-9a-f]{40,64}$/);
    expect((await snaps.diff(before, after!)).files).toEqual(['src/a.ts']);
    expect(fs.existsSync(path.join(dir, '.git', 'index'))).toBe(false);
  });

  it('ตัด diff ไม่ผ่ากลาง surrogate pair ของ emoji', async () => {
    initRepo();
    const snaps = new GitSnapshots(dir, 10_000);
    const before = (await snaps.snapshot())!;
    write('src/e.ts', '😀'.repeat(6000) + '\n');
    const after = (await snaps.snapshot())!;
    const full = (await new GitSnapshots(dir, 10_000_000).diff(before, after)).diff;
    // หาขอบที่ตัวอักษรตัวสุดท้ายเป็น high surrogate พอดี
    let max = 0;
    for (let i = 1; i < full.length; i++) {
      const c = full.charCodeAt(i - 1);
      if (c >= 0xd800 && c <= 0xdbff) {
        max = i;
        break;
      }
    }
    const cut = await new GitSnapshots(dir, max).diff(before, after);
    expect(cut.truncated).toBe(true);
    expect(cut.diff.length).toBe(max - 1);
    const last = cut.diff.charCodeAt(cut.diff.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
  });
});
