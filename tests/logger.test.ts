import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UserIO } from '../src/deps';
import { FileLogger, LoggingIO, type Logger, nullLogger } from '../src/logger';
import { ScriptedIO } from './helpers/fakes';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-log-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const fixed = () => new Date('2026-09-20T09:30:00.123Z');

describe('FileLogger', () => {
  it('เขียนบรรทัด "เวลา LEVEL event {json}" และสร้างโฟลเดอร์ให้เอง', () => {
    const file = path.join(tmp(), 'nested', 'agent-team.log');
    const log = new FileLogger(file, fixed);
    log.log('INFO', 'phase.change', { from: 'DESIGN', to: 'REVIEW' });
    log.log('WARN', 'guard.deny');

    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toEqual([
      '2026-09-20T09:30:00.123Z INFO  phase.change {"from":"DESIGN","to":"REVIEW"}',
      '2026-09-20T09:30:00.123Z WARN  guard.deny',
    ]);
  });

  it('ต่อท้ายไฟล์เดิมข้ามรอบรัน (resume)', () => {
    const file = path.join(tmp(), 'agent-team.log');
    new FileLogger(file, fixed).log('INFO', 'run.start');
    new FileLogger(file, fixed).log('INFO', 'run.start');
    expect(fs.readFileSync(file, 'utf8').trimEnd().split('\n')).toHaveLength(2);
  });

  it('ข้อความหลายบรรทัดยังอยู่ในบรรทัดเดียว และตัดข้อความที่ยาวมาก', () => {
    const file = path.join(tmp(), 'agent-team.log');
    new FileLogger(file, fixed).log('INFO', 'say', { text: `a\nb${'x'.repeat(5000)}` });
    const content = fs.readFileSync(file, 'utf8');
    expect(content.trimEnd().split('\n')).toHaveLength(1);
    expect(content).toContain('a\\nb');
    expect(content).toContain('…(ตัด');
    expect(content.length).toBeLessThan(2500);
  });

  it('เขียนไฟล์ไม่ได้ต้องไม่ทำให้งานล้ม', () => {
    const blocker = path.join(tmp(), 'file');
    fs.writeFileSync(blocker, 'x');
    const log = new FileLogger(path.join(blocker, 'agent-team.log'), fixed);
    expect(() => log.log('ERROR', 'run.error', { message: 'boom' })).not.toThrow();
  });
});

describe('nullLogger', () => {
  it('ไม่ทำอะไรและไม่ error', () => {
    expect(() => nullLogger.log('INFO', 'x', { a: 1 })).not.toThrow();
  });
});

describe('LoggingIO', () => {
  const spy = () => {
    const events: Array<{ level: string; event: string; data?: unknown }> = [];
    const logger: Logger = { log: (level, event, data) => void events.push({ level, event, data }) };
    return { events, logger };
  };

  it('say: ส่งต่อให้ io เดิมและบันทึกข้อความ', () => {
    const inner = new ScriptedIO([]);
    const { events, logger } = spy();
    new LoggingIO(inner, logger).say('สวัสดี');
    expect(inner.said).toEqual(['สวัสดี']);
    expect(events).toEqual([{ level: 'INFO', event: 'say', data: { text: 'สวัสดี' } }]);
  });

  it('ask: บันทึกคำถามและคำตอบของ user', async () => {
    const { events, logger } = spy();
    const io = new LoggingIO(new ScriptedIO(['อยากได้ todo']), logger);
    expect(await io.ask('> ')).toBe('อยากได้ todo');
    expect(events).toEqual([{ level: 'INFO', event: 'user.input', data: { prompt: '> ', answer: 'อยากได้ todo' } }]);
  });

  it('choose: บันทึกตัวเลือกที่ user เลือก', async () => {
    const { events, logger } = spy();
    const io = new LoggingIO(new ScriptedIO(['confirm']), logger);
    expect(await io.choose('ยืนยัน?', ['confirm', 'revise'] as const)).toBe('confirm');
    expect(events).toEqual([
      { level: 'INFO', event: 'user.choice', data: { prompt: 'ยืนยัน?', choice: 'confirm' } },
    ]);
  });

  it('chooseOrText: บันทึก user.choice เมื่อเลือกตรงตัวเลือก', async () => {
    const { events, logger } = spy();
    const io = new LoggingIO(new ScriptedIO(['confirm']), logger);
    expect(await io.chooseOrText('ยืนยัน?', ['confirm', 'revise'] as const)).toBe('confirm');
    expect(events).toEqual([
      { level: 'INFO', event: 'user.choice', data: { prompt: 'ยืนยัน?', choice: 'confirm' } },
    ]);
  });

  it('chooseOrText: บันทึก user.question เมื่อพิมพ์คำถามแทนตัวเลือก', async () => {
    const { events, logger } = spy();
    const io = new LoggingIO(new ScriptedIO(['ทำไมต้องทำแบบนี้']), logger);
    const result = await io.chooseOrText('ยืนยัน?', ['confirm', 'revise'] as const);
    expect(result).toEqual({ text: 'ทำไมต้องทำแบบนี้' });
    expect(events).toEqual([
      { level: 'INFO', event: 'user.question', data: { prompt: 'ยืนยัน?', question: 'ทำไมต้องทำแบบนี้' } },
    ]);
  });

  it('ask ที่ล้ม (เช่น stdin ปิด) ไม่กลืน error', async () => {
    const failing: UserIO = {
      say() {},
      ask: async () => {
        throw new Error('EOF');
      },
      choose: async () => {
        throw new Error('EOF');
      },
      chooseOrText: async () => {
        throw new Error('EOF');
      },
    };
    const { events, logger } = spy();
    await expect(new LoggingIO(failing, logger).ask('> ')).rejects.toThrow('EOF');
    expect(events).toEqual([]);
  });
});
