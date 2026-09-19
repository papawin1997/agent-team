import { describe, expect, it } from 'vitest';
import { asking, makeDesign, passReport } from './helpers/builders';
import { makeDeps, ScriptedIO } from './helpers/fakes';

describe('ScriptedIO', () => {
  it('ตอบตามลำดับและบันทึกคำถาม', async () => {
    const io = new ScriptedIO(['a', 'confirm']);
    expect(await io.ask('q1')).toBe('a');
    expect(await io.choose('q2', ['confirm', 'revise'] as const)).toBe('confirm');
    expect(io.asked).toEqual(['q1', 'q2']);
  });

  it('โยน error เมื่อคำตอบหมด', async () => {
    await expect(new ScriptedIO([]).ask('q')).rejects.toThrow('ไม่มีคำตอบเหลือ');
  });

  it('choose โยน error เมื่อคำตอบไม่อยู่ในตัวเลือก', async () => {
    await expect(new ScriptedIO(['zzz']).choose('q', ['a', 'b'] as const)).rejects.toThrow('ไม่อยู่ใน');
  });
});

describe('FakeRunner / MemoryStore', () => {
  it('ดึงจาก script ตามลำดับและบันทึก call', async () => {
    const { runner } = makeDeps({ pm: [asking('x')], plans: [makeDesign()], qa: [passReport('a')] }, []);
    expect((await runner.pmTurn({ prompt: 'p' })).turn.message).toBe('x');
    expect((await runner.plan({ requirements: undefined as never })).tasks).toHaveLength(2);
    expect(runner.calls.map((c) => c.role)).toEqual(['pm', 'planning']);
  });

  it('โยน error เมื่อ script หมด', async () => {
    const { runner } = makeDeps({}, []);
    await expect(runner.pmTurn({ prompt: 'p' })).rejects.toThrow('script หมด');
  });

  it('MemoryStore คัดลอกข้อมูลตอน save/load', async () => {
    const { store } = makeDeps({}, []);
    const state = { version: 1 as const, phase: 'BUILD' as const, progress: {} };
    await store.save(state);
    state.phase = 'DONE' as never;
    expect((await store.load())?.phase).toBe('BUILD');
  });
});
