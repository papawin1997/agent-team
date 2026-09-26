import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args';

describe('parseArgs', () => {
  it('อ่าน --project และแปลงเป็นพาธเต็ม', () => {
    expect(parseArgs(['--project', 'some/app'])).toEqual({
      projectDir: path.resolve('some/app'),
      resume: false,
    });
  });

  it('อ่านรูปแบบ --project=พาธ', () => {
    expect(parseArgs(['--project=some/app']).projectDir).toBe(path.resolve('some/app'));
  });

  it('รับ path แบบ positional', () => {
    expect(parseArgs(['some/app']).projectDir).toBe(path.resolve('some/app'));
    expect(parseArgs(['.']).projectDir).toBe(path.resolve('.'));
  });

  it('อ่าน --resume และตัวย่อ -r', () => {
    expect(parseArgs(['--project', 'a', '--resume']).resume).toBe(true);
    expect(parseArgs(['a', '-r']).resume).toBe(true);
  });

  it('ไม่ระบุโปรเจกต์ -> projectDir เป็น undefined (ให้เลือกจากเมนู)', () => {
    expect(parseArgs([])).toEqual({ projectDir: undefined, resume: false });
    expect(parseArgs(['-r'])).toEqual({ projectDir: undefined, resume: true });
  });

  it('--project ที่ไม่มีค่า หรือค่าเป็น flag อื่น หรือว่าง -> error', () => {
    expect(() => parseArgs(['--project', '--resume'])).toThrow('--project');
    expect(() => parseArgs(['--project', '-r'])).toThrow('--project');
    expect(() => parseArgs(['--project'])).toThrow('--project');
    expect(() => parseArgs(['--project='])).toThrow('--project');
  });

  it('ระบุโปรเจกต์มากกว่าหนึ่งครั้ง -> error', () => {
    expect(() => parseArgs(['a', 'b'])).toThrow('ครั้งเดียว');
    expect(() => parseArgs(['--project', 'a', 'b'])).toThrow('ครั้งเดียว');
  });

  it('อาร์กิวเมนต์ที่ไม่รู้จัก -> error', () => {
    expect(() => parseArgs(['--project', 'a', '--nope'])).toThrow('--nope');
    expect(() => parseArgs(['-x'])).toThrow('-x');
  });
});
