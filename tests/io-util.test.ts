import { describe, expect, it } from 'vitest';
import { askNonEmpty, decide } from '../src/io-util';
import { LoggingIO } from '../src/logger';
import { newState } from '../src/state';
import { asking } from './helpers/builders';
import { ScriptedIO, makeDeps } from './helpers/fakes';

describe('askNonEmpty', () => {
  it('returns trimmed non-empty answer', async () => {
    const io = new ScriptedIO(['answer']);
    const result = await askNonEmpty(io, 'prompt?');
    expect(result).toBe('answer');
  });

  it('trims whitespace', async () => {
    const io = new ScriptedIO(['  answer  ']);
    const result = await askNonEmpty(io, 'prompt?');
    expect(result).toBe('answer');
  });

  it('re-asks on empty string', async () => {
    const io = new ScriptedIO(['', 'answer']);
    const result = await askNonEmpty(io, 'prompt?');
    expect(result).toBe('answer');
    expect(io.asked).toHaveLength(2);
    expect(io.said).toContain('กรุณาพิมพ์ข้อความ (ห้ามเว้นว่าง)');
  });

  it('re-asks on whitespace-only answer', async () => {
    const io = new ScriptedIO(['  ', '\t\n', 'answer']);
    const result = await askNonEmpty(io, 'prompt?');
    expect(result).toBe('answer');
    expect(io.asked).toHaveLength(3);
    expect(io.said.filter((s) => s === 'กรุณาพิมพ์ข้อความ (ห้ามเว้นว่าง)')).toHaveLength(2);
  });

  it('propagates ScriptedIO exhaustion as error', async () => {
    const io = new ScriptedIO(['', '']);
    await expect(askNonEmpty(io, 'prompt?')).rejects.toThrow('ScriptedIO: ไม่มีคำตอบเหลือ');
  });
});

describe('decide', () => {
  it('เลือกตรง ๆ โดยไม่ต้องถาม PM เลย', async () => {
    const { deps, runner } = makeDeps({}, ['confirm']);
    const state = newState();
    const result = await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    expect(result).toBe('confirm');
    expect(runner.calls).toHaveLength(0);
  });

  it('พิมพ์คำถามก่อน -> PM ตอบ -> ถามตัวเลือกเดิมซ้ำจนกว่าจะเลือกจริง', async () => {
    const { deps, runner, io, store } = makeDeps(
      { pm: [asking('เพราะ backend ต้องเสร็จก่อน frontend ถึงจะเทสได้')] },
      ['ทำไม backend ต้องทำก่อน', 'confirm'],
    );
    const state = newState();
    const result = await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    expect(result).toBe('confirm');
    expect(runner.calls).toHaveLength(1);
    expect((runner.calls[0]!.input as { prompt: string }).prompt).toContain('ทำไม backend ต้องทำก่อน');
    expect(io.said.some((s) => s.includes('เพราะ backend ต้องเสร็จก่อน'))).toBe(true);
    expect(store.state?.pmSessionId).toBe('pm-session');
  });

  it('ถามได้หลายครั้งติดกันก่อนจะเลือกจริง', async () => {
    const { deps, runner } = makeDeps(
      { pm: [asking('คำตอบ 1'), asking('คำตอบ 2')] },
      ['คำถาม 1', 'คำถาม 2', 'revise'],
    );
    const state = newState();
    const result = await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    expect(result).toBe('revise');
    expect(runner.calls).toHaveLength(2);
  });

  it('ส่ง sessionId เดิมเข้า PM ทุกครั้งที่ถาม (ต่อบทสนทนาเดียวกัน ไม่เริ่มใหม่)', async () => {
    const { deps, runner } = makeDeps(
      { pm: [asking('ตอบ 1'), asking('ตอบ 2')] },
      ['คำถาม 1', 'คำถาม 2', 'confirm'],
    );
    const state = newState();
    state.pmSessionId = 'existing-session';
    await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    expect((runner.calls[0]!.input as { sessionId?: string }).sessionId).toBe('existing-session');
  });

  it('พิมพ์ว่าง (Enter เปล่า) ไม่ส่งไปหา PM แค่ถามซ้ำ', async () => {
    const { deps, runner } = makeDeps({}, ['', 'confirm']);
    const state = newState();
    const result = await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    expect(result).toBe('confirm');
    expect(runner.calls).toHaveLength(0);
  });

  it('PM ตอบไม่สำเร็จระหว่างถามคำถาม -> ไม่ทำให้ decide พัง แสดงข้อความเตือนแล้วถามใหม่ได้ต่อ', async () => {
    const { deps, io } = makeDeps({}, ['คำถามแรก', 'confirm']);
    const state = newState();
    const result = await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    expect(result).toBe('confirm');
    expect(io.said.some((s) => s.includes('ถาม PM ไม่สำเร็จ'))).toBe(true);
  });

  it('ทำงานถูกต้องเมื่อ io เป็น LoggingIO ห่อ IO อื่นไว้ (composition จริงที่ใช้ตอน production)', async () => {
    const { deps, runner } = makeDeps({ pm: [asking('คำตอบ')] }, ['คำถาม', 'confirm']);
    deps.io = new LoggingIO(deps.io, { log: () => {} });
    const state = newState();

    const result = await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    expect(result).toBe('confirm');
    expect(runner.calls).toHaveLength(1);
  });

  it('เรียก onTurn callback ด้วย turn ล่าสุดทุกครั้งที่ PM ตอบคำถามสำเร็จ', async () => {
    const { deps } = makeDeps({ pm: [asking('คำตอบ')] }, ['คำถาม', 'confirm']);
    const state = newState();
    const seen: string[] = [];
    const result = await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const, (turn) => {
      seen.push(turn.message);
    });

    expect(result).toBe('confirm');
    expect(seen).toEqual(['คำตอบ']);
  });

  it('ไม่เรียก onTurn เมื่อ pmTurn ล้มเหลว', async () => {
    const { deps } = makeDeps({}, ['คำถาม', 'confirm']);
    const state = newState();
    const seen: string[] = [];
    await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const, (turn) => {
      seen.push(turn.message);
    });

    expect(seen).toEqual([]);
  });

  it('ส่งบริบทของ prompt และตัวเลือกที่ค้างอยู่ไปให้ PM ด้วย ไม่ใช่แค่คำถามเปล่า ๆ', async () => {
    const { deps, runner } = makeDeps({ pm: [asking('คำตอบ')] }, ['ทำไมต้องเลือกแบบนี้', 'confirm']);
    const state = newState();
    await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    const sentPrompt = (runner.calls[0]!.input as { prompt: string }).prompt;
    expect(sentPrompt).toContain('ยืนยันไหม?');
    expect(sentPrompt).toContain('confirm');
    expect(sentPrompt).toContain('revise');
    expect(sentPrompt).toContain('ทำไมต้องเลือกแบบนี้');
  });

  it('แสดงคำตอบของ PM ก่อนพยายามบันทึก state — save ที่ล้มไม่ทำให้คำตอบหาย หรือถูกเข้าใจผิดว่า PM ตอบไม่สำเร็จ', async () => {
    const { deps, io } = makeDeps({ pm: [asking('คำตอบ')] }, ['คำถาม', 'confirm']);
    deps.store.save = async () => {
      throw new Error('เขียนดิสก์ไม่สำเร็จ');
    };
    const state = newState();
    const result = await decide(deps, state, 'ยืนยันไหม?', ['confirm', 'revise'] as const);

    expect(result).toBe('confirm');
    expect(io.said.some((s) => s.includes('คำตอบ'))).toBe(true);
    expect(io.said.some((s) => s.includes('บันทึกสถานะไม่สำเร็จ'))).toBe(true);
    expect(io.said.some((s) => s.includes('ถาม PM ไม่สำเร็จ'))).toBe(false);
  });
});
