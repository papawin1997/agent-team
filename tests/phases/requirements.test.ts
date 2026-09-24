import { describe, expect, it } from 'vitest';
import type { PmInput } from '../../src/deps';
import { runRequirements } from '../../src/phases/requirements';
import { newState } from '../../src/state';
import { asking, makeRequirements, proposal } from '../helpers/builders';
import { makeDeps } from '../helpers/fakes';

const pmInput = (runner: { calls: { input: unknown }[] }, i: number) => runner.calls[i]!.input as PmInput;

describe('runRequirements', () => {
  it('ถามต่อจน PM เสนอ requirements แล้ว user confirm -> DESIGN', async () => {
    const { deps, runner, store, io } = makeDeps(
      { pm: [asking('ใช้ tech อะไร?'), proposal()] },
      ['อยากได้ todo list', 'ใช้ Express', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(state.requirements).toEqual(makeRequirements());
    expect(state.pmSessionId).toBe('pm-session');
    expect(store.artifacts.get('requirements.json')).toEqual(makeRequirements());
    expect(pmInput(runner, 0).prompt).toBe('อยากได้ todo list');
    expect(pmInput(runner, 1).prompt).toBe('ใช้ Express');
    expect(pmInput(runner, 1).sessionId).toBe('pm-session');
    expect(io.said.join('\n')).toContain('ใช้ tech อะไร?');
    expect(io.said.join('\n')).toContain('todo list');
  });

  it('user ขอแก้ requirements: PM คุยต่อแล้วเสนอใหม่', async () => {
    const { deps, runner, store } = makeDeps(
      { pm: [proposal(), proposal({ ...makeRequirements(), goal: 'todo list v2' })] },
      ['x', 'revise', 'ปรับ scope', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(runner.calls).toHaveLength(2);
    expect(pmInput(runner, 1).prompt).toBe('ปรับ scope');
    expect(state.requirements?.goal).toBe('todo list v2');
    expect(store.saves).toBeGreaterThanOrEqual(2);
  });

  it('revise does not finish phase until confirm', async () => {
    const { deps, store } = makeDeps(
      { pm: [proposal(), proposal({ ...makeRequirements(), goal: 'todo list v2' })] },
      ['x', 'revise', 'ปรับ scope', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    // After first PM turn + revise choice, before confirm decision, phase should still be REQUIREMENTS
    expect(state.phase).toBe('DESIGN');
    // Check that requirements were never undefined after revise (they should be set only on confirm)
    expect(state.requirements?.goal).toBe('todo list v2');
  });

  it('ใช้ pendingPrompt แทนการถามใหม่ และแนบ requirements เดิม', async () => {
    const { deps, runner, io } = makeDeps({ pm: [proposal()] }, ['confirm']);
    const state = newState();
    state.requirements = makeRequirements();
    state.pendingPrompt = 'แก้ให้มี login';
    await runRequirements(deps, state);

    expect(pmInput(runner, 0).prompt).toContain('แก้ให้มี login');
    expect(pmInput(runner, 0).prompt).toContain('"goal":"todo list"');
    expect(io.asked).toHaveLength(1);
    expect(state.pendingPrompt).toBeUndefined();
  });

  it('proposal ที่ไม่มี requirements ถือเป็นการถามต่อ', async () => {
    const { deps, runner } = makeDeps(
      { pm: [{ message: 'ยังไม่ครบ', status: 'proposal' }, proposal()] },
      ['เริ่ม', 'ต่อ', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(pmInput(runner, 1).prompt).toBe('ต่อ');
  });

  it('empty answer is never sent to PM', async () => {
    const { deps, runner, io } = makeDeps(
      { pm: [proposal()] },
      ['', '  ', 'อยากได้ todo list', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(runner.calls).toHaveLength(1);
    expect(pmInput(runner, 0).prompt).toBe('อยากได้ todo list');
  });

  it('asserts persistence: pmSessionId and saves', async () => {
    const { deps, runner, store, io } = makeDeps(
      { pm: [asking('ใช้ tech อะไร?'), proposal()] },
      ['อยากได้ todo list', 'ใช้ Express', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.pmSessionId).toBe('pm-session');
    expect(store.saves).toBeGreaterThanOrEqual(runner.calls.length);
  });

  it('resume opening text when pmSessionId already set', async () => {
    const { deps, io } = makeDeps({ pm: [proposal()] }, ['ข้อมูลเพิ่ม', 'confirm']);
    const state = newState();
    state.pmSessionId = 'pm-session';
    await runRequirements(deps, state);

    expect(io.asked[0]).toBe('พิมพ์ข้อความถึง PM เพื่อคุยต่อ\n> ');
  });

  it('พิมพ์คำถามแทนการเลือก confirm/revise -> PM ตอบก่อน แล้วถามใหม่จนกว่าจะเลือกจริง', async () => {
    const { deps, runner, io } = makeDeps(
      { pm: [asking('ใช้ tech อะไร?'), proposal(), asking('เพราะ Express เบาและเร็วพอสำหรับ todo list')] },
      ['อยากได้ todo list', 'ใช้ Express', 'ทำไมต้องใช้ Express', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(runner.calls).toHaveLength(3);
    expect(pmInput(runner, 2).prompt).toBe('ทำไมต้องใช้ Express');
    expect(io.said.join('\n')).toContain('เพราะ Express เบาและเร็วพอ');
  });
});
