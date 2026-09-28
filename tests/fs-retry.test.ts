import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RENAME_RETRIES, renameWithRetry, renameWithRetrySync } from '../src/fs-retry';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-fs-retry-'));
});

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe('renameWithRetry', () => {
  it('EPERM/EBUSY/EACCES ชั่วคราว → retry แล้วสำเร็จ', async () => {
    const from = path.join(dir, 'a.tmp');
    const to = path.join(dir, 'a');
    fs.writeFileSync(from, 'x');
    const codes = ['EPERM', 'EBUSY', 'EACCES'];
    const rename = vi.fn(async (f: string, t: string) => {
      const code = codes.shift();
      if (code) throw errno(code);
      fs.renameSync(f, t);
    });
    const sleep = vi.fn(async () => {});
    await renameWithRetry(from, to, { rename, sleep });
    expect(rename).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(fs.readFileSync(to, 'utf8')).toBe('x');
  });

  it('ล้มตลอด → throw error เดิมหลังครบจำนวน retry และลบไฟล์ต้นทาง', async () => {
    const from = path.join(dir, 'b.tmp');
    fs.writeFileSync(from, 'x');
    const rename = vi.fn(async () => {
      throw errno('EPERM');
    });
    await expect(renameWithRetry(from, path.join(dir, 'b'), { rename, sleep: async () => {} })).rejects.toThrow('EPERM');
    expect(rename).toHaveBeenCalledTimes(RENAME_RETRIES + 1);
    expect(fs.existsSync(from)).toBe(false);
  });

  it('error อื่น (เช่น ENOENT) ไม่ retry', async () => {
    const rename = vi.fn(async () => {
      throw errno('ENOENT');
    });
    await expect(renameWithRetry(path.join(dir, 'x'), path.join(dir, 'y'), { rename })).rejects.toThrow('ENOENT');
    expect(rename).toHaveBeenCalledTimes(1);
  });
});

describe('renameWithRetrySync', () => {
  it('EPERM ชั่วคราวแล้วสำเร็จ / ล้มตลอด → throw และลบไฟล์ต้นทาง', () => {
    const from = path.join(dir, 'c.tmp');
    fs.writeFileSync(from, 'x');
    let fails = 2;
    renameWithRetrySync(from, path.join(dir, 'c'), {
      rename: (f, t) => {
        if (fails-- > 0) throw errno('EPERM');
        fs.renameSync(f, t);
      },
      sleep: () => {},
    });
    expect(fs.readFileSync(path.join(dir, 'c'), 'utf8')).toBe('x');

    fs.writeFileSync(from, 'y');
    const rename = vi.fn(() => {
      throw errno('EBUSY');
    });
    expect(() => renameWithRetrySync(from, path.join(dir, 'c'), { rename, sleep: () => {} })).toThrow('EBUSY');
    expect(rename).toHaveBeenCalledTimes(RENAME_RETRIES + 1);
    expect(fs.existsSync(from)).toBe(false);
  });
});
