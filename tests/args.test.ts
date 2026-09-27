import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args';

describe('parseArgs', () => {
  it('อ่าน --project และแปลงเป็นพาธเต็ม', () => {
    expect(parseArgs(['--project', 'some/app'])).toEqual({
      command: 'run',
      projectDir: path.resolve('some/app'),
      resume: false,
      live: false,
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
    expect(parseArgs([])).toEqual({ command: 'run', projectDir: undefined, resume: false, live: false });
    expect(parseArgs(['-r'])).toEqual({ command: 'run', projectDir: undefined, resume: true, live: false });
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

  it('logs เป็นคำสั่งย่อย: ไม่มี path / มี path / --live', () => {
    expect(parseArgs(['logs'])).toEqual({ command: 'logs', projectDir: undefined, resume: false, live: false });
    expect(parseArgs(['logs', 'some/app', '--live'])).toEqual({
      command: 'logs',
      projectDir: path.resolve('some/app'),
      resume: false,
      live: true,
    });
    expect(parseArgs(['logs', '--project', 'a']).projectDir).toBe(path.resolve('a'));
  });

  it('โฟลเดอร์ชื่อ logs ต้องพิมพ์ ./logs', () => {
    expect(parseArgs(['./logs'])).toMatchObject({ command: 'run', projectDir: path.resolve('logs') });
  });

  it('--live นอก logs และ -r กับ logs -> error', () => {
    expect(() => parseArgs(['--live'])).toThrow('--live');
    expect(() => parseArgs(['logs', '-r'])).toThrow('--resume');
  });
});
