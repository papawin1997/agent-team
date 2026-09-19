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

  it('อ่าน --resume', () => {
    expect(parseArgs(['--project', 'a', '--resume']).resume).toBe(true);
  });

  it('ไม่ระบุ --project -> error', () => {
    expect(() => parseArgs([])).toThrow('--project');
    expect(() => parseArgs(['--project'])).toThrow('--project');
  });

  it('--project ที่ไม่มีค่า หรือค่าเป็น flag อื่น หรือว่าง -> error', () => {
    expect(() => parseArgs(['--project', '--resume'])).toThrow('--project');
    expect(() => parseArgs(['--project'])).toThrow('--project');
    expect(() => parseArgs(['--project='])).toThrow('--project');
  });

  it('อาร์กิวเมนต์ที่ไม่รู้จัก -> error', () => {
    expect(() => parseArgs(['--project', 'a', '--nope'])).toThrow('--nope');
  });
});
