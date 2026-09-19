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
    const { deps, runner } = makeDeps(
      { pm: [proposal(), proposal()] },
      ['x', 'revise', 'ปรับ scope', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(runner.calls).toHaveLength(2);
    expect(pmInput(runner, 1).prompt).toBe('ปรับ scope');
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
});
