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

  it('--quick / --standard / --full ใส่ได้อย่างเดียว', () => {
    expect(parseArgs(['a', '--quick']).level).toBe('quick');
    expect(parseArgs(['a', '--standard']).level).toBe('standard');
    expect(parseArgs(['--full']).level).toBe('full');
    expect(parseArgs(['--standard', '--standard']).level).toBe('standard');
    expect(() => parseArgs(['--quick', '--full'])).toThrow('พร้อมกันไม่ได้');
    expect(() => parseArgs(['--standard', '--full'])).toThrow('พร้อมกันไม่ได้');
    expect(() => parseArgs(['logs', '--standard'])).toThrow('logs');
  });

  it('run --headless รับ --standard', () => {
    expect(parseArgs(['run', '--headless', '--request', 'x', '--standard']).level).toBe('standard');
  });
});

describe('parseArgs --headless', () => {
  it('--headless --request: งานใหม่ ใช้ cwd เมื่อไม่ระบุโปรเจกต์', () => {
    expect(parseArgs(['--headless', '--request', 'อยากได้ todo'])).toMatchObject({
      command: 'run',
      projectDir: path.resolve('.'),
      headless: true,
      request: 'อยากได้ todo',
    });
  });

  it('--headless --job และ --headless --resume', () => {
    expect(parseArgs(['--headless', '--project', 'a', '--job', '20260928-101500'])).toMatchObject({
      headless: true,
      job: '20260928-101500',
      projectDir: path.resolve('a'),
    });
    expect(parseArgs(['--headless', '-r'])).toMatchObject({ headless: true, resume: true });
  });

  // บรรทัดคำสั่งเดียวกับใน claude-skill/agent-team/SKILL.md และ README
  it('คำสั่ง run นำหน้า (ตาม SKILL.md/README): งานใหม่, --resume, --job', () => {
    expect(
      parseArgs(['run', '--headless', '--project', 'C:/work/my/app', '--request', 'ทำหน้า login', '--quick']),
    ).toMatchObject({
      command: 'run',
      headless: true,
      request: 'ทำหน้า login',
      level: 'quick',
      projectDir: path.resolve('C:/work/my/app'),
    });
    expect(parseArgs(['run', '--headless', '--project', 'C:/work/my/app', '--resume'])).toMatchObject({
      command: 'run',
      headless: true,
      resume: true,
      projectDir: path.resolve('C:/work/my/app'),
    });
    expect(parseArgs(['run', '--headless', '--project', 'C:/work/my/app', '--job', '20260928-101500'])).toMatchObject({
      command: 'run',
      headless: true,
      job: '20260928-101500',
      projectDir: path.resolve('C:/work/my/app'),
    });
    // ไม่ระบุ --project = cwd (ไม่ใช่ <cwd>/run)
    expect(parseArgs(['run', '--headless', '--request', 'x']).projectDir).toBe(path.resolve('.'));
  });

  it('ไม่มี run นำหน้ายังใช้ได้เหมือนเดิม และโฟลเดอร์ชื่อ run ต้องพิมพ์ ./run', () => {
    expect(parseArgs(['C:/work/my/app'])).toMatchObject({ command: 'run', projectDir: path.resolve('C:/work/my/app') });
    expect(parseArgs(['--project', 'x'])).toMatchObject({ command: 'run', projectDir: path.resolve('x') });
    expect(parseArgs(['./run'])).toMatchObject({ command: 'run', projectDir: path.resolve('run') });
  });

  it('ไม่ใส่ --headless ไม่มี key headless', () => {
    expect(parseArgs(['--project', 'a'])).not.toHaveProperty('headless');
  });

  it.each([
    [['--headless'], 'อย่างใดอย่างหนึ่ง'],
    [['--headless', '--request', 'x', '--resume'], 'อย่างใดอย่างหนึ่ง'],
    [['--headless', '--request', 'x', '--job', '20260928-101500'], 'อย่างใดอย่างหนึ่ง'],
    [['--request', 'x'], 'ใช้คู่กับ --headless'],
    [['--job', '20260928-101500'], 'ใช้คู่กับ --headless'],
    [['--headless', '--request'], 'ต้องระบุค่าหลัง --request'],
    [['--headless', '--request', '   '], 'ห้ามว่าง'],
    [['--headless', '--job', '../x'], 'jobId ไม่ถูกรูปแบบ'],
    [['logs', '--headless'], 'agent-team logs ไม่ได้'],
  ])('%j → error', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('parseArgs: ask', () => {
  it('agent-team ask -> command ask (ให้เลือกโปรเจกต์จากเมนู)', () => {
    expect(parseArgs(['ask'])).toEqual({ command: 'ask', projectDir: undefined, resume: false, live: false });
  });
  it('รับ --project, path แบบ positional, --resume และระดับงาน', () => {
    expect(parseArgs(['ask', '--project', 'a']).projectDir).toBe(path.resolve('a'));
    expect(parseArgs(['ask', 'a', '-r']).resume).toBe(true);
    expect(parseArgs(['ask', '--quick']).level).toBe('quick');
  });
  it('ใช้กับ --headless หรือ --live ไม่ได้', () => {
    expect(() => parseArgs(['ask', '--headless', '--request', 'x'])).toThrow('--headless ใช้กับ agent-team ask ไม่ได้');
    expect(() => parseArgs(['ask', '--live'])).toThrow('--live');
  });
});
