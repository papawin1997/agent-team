import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WAIT_SEC, isHeadlessCommand, parseHeadlessCommand } from '../../src/headless/args';

describe('isHeadlessCommand', () => {
  it('รู้จักเฉพาะคำสั่งย่อยของ headless', () => {
    for (const word of ['wait', 'status', 'answer', 'stop', 'install-skill']) expect(isHeadlessCommand(word)).toBe(true);
    for (const word of ['logs', 'run', undefined, '--headless']) expect(isHeadlessCommand(word)).toBe(false);
  });
});

describe('parseHeadlessCommand', () => {
  it('wait: ค่าเริ่มต้น cwd, timeout 540', () => {
    expect(parseHeadlessCommand(['wait'])).toEqual({ command: 'wait', projectDir: path.resolve('.'), timeoutSec: DEFAULT_WAIT_SEC });
  });

  it('wait: --project --job --since --timeout', () => {
    expect(
      parseHeadlessCommand(['wait', '--project', 'a', '--job', '20260928-101500', '--since', '12', '--timeout', '60']),
    ).toEqual({ command: 'wait', projectDir: path.resolve('a'), job: '20260928-101500', since: 12, timeoutSec: 60 });
  });

  it('status: timeout = 0 เสมอ และไม่รับ --timeout', () => {
    expect(parseHeadlessCommand(['status', '--since', '3'])).toMatchObject({ command: 'status', since: 3, timeoutSec: 0 });
    expect(() => parseHeadlessCommand(['status', '--timeout', '5'])).toThrow('อาร์กิวเมนต์ไม่รู้จัก');
  });

  it('answer: ข้อความหนึ่งค่า และใช้ -- เพื่อส่งข้อความที่ขึ้นต้นด้วย -', () => {
    expect(parseHeadlessCommand(['answer', '--job', '20260928-101500', 'confirm'])).toMatchObject({
      command: 'answer',
      job: '20260928-101500',
      text: 'confirm',
    });
    expect(parseHeadlessCommand(['answer', '--', '-ไม่เอา login'])).toMatchObject({ text: '-ไม่เอา login' });
    expect(parseHeadlessCommand(['answer', ''])).toMatchObject({ text: '' });
  });

  it('stop และ install-skill', () => {
    expect(parseHeadlessCommand(['stop', '--project', 'a'])).toEqual({ command: 'stop', projectDir: path.resolve('a') });
    expect(parseHeadlessCommand(['install-skill'])).toEqual({ command: 'install-skill' });
  });

  it.each([
    [['answer'], 'ข้อความคำตอบ 1 ค่า'],
    [['answer', 'a', 'b'], 'ข้อความคำตอบ 1 ค่า'],
    [['wait', '--since', '-1'], 'จำนวนเต็ม'],
    [['wait', '--timeout', '3601'], '0-3600'],
    [['wait', '--job', '../x'], 'jobId ไม่ถูกรูปแบบ'],
    [['wait', '--project'], 'ต้องระบุพาธหลัง --project'],
    [['wait', 'extra'], 'ไม่รับค่า'],
    [['install-skill', '--x'], 'ไม่รับอาร์กิวเมนต์'],
    [['answer', '--since', '1', 'x'], 'อาร์กิวเมนต์ไม่รู้จัก'],
  ])('%j → error', (argv, message) => {
    expect(() => parseHeadlessCommand(argv)).toThrow(message);
  });
});
