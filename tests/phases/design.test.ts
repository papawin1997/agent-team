import { describe, expect, it } from 'vitest';
import type { PlanInput } from '../../src/deps';
import { DesignError } from '../../src/domain';
import { runDesign, runReview } from '../../src/phases/design';
import { newState, type State } from '../../src/state';
import { asking, makeDesign, makeRequirements, makeTask } from '../helpers/builders';
import { makeDeps } from '../helpers/fakes';

const stateAt = (phase: State['phase']): State => {
  const state = newState();
  state.phase = phase;
  state.requirements = makeRequirements();
  return state;
};

describe('runDesign', () => {
  it('ได้ design ที่ถูกต้อง -> REVIEW และบันทึก design.json', async () => {
    const design = makeDesign();
    const { deps, store } = makeDeps({ plans: [design] }, []);
    const state = stateAt('DESIGN');
    await runDesign(deps, state);

    expect(state.phase).toBe('REVIEW');
    expect(state.design).toEqual(design);
    expect(store.artifacts.get('design.json')).toEqual(design);
  });

  it('design วน dependency: ส่ง feedback ให้ Planning แล้วได้ design ใหม่', async () => {
    const cyclic = makeDesign([makeTask('a', 'backend', ['b']), makeTask('b', 'backend', ['a'])]);
    const good = makeDesign();
    const { deps, runner } = makeDeps({ plans: [cyclic, good] }, []);
    const state = stateAt('DESIGN');
    await runDesign(deps, state);

    expect(state.design).toEqual(good);
    expect((runner.calls[1]!.input as PlanInput).feedback).toContain('dependency วน');
  });

  it('ส่ง design ผิดซ้ำ 2 ครั้ง -> โยน DesignError', async () => {
    const cyclic = makeDesign([makeTask('a', 'backend', ['b']), makeTask('b', 'backend', ['a'])]);
    const { deps } = makeDeps({ plans: [cyclic, cyclic] }, []);
    await expect(runDesign(deps, stateAt('DESIGN'))).rejects.toThrow(DesignError);
  });

  it('ส่ง design เดิมและ requirements ให้ Planning', async () => {
    const previous = makeDesign();
    const { deps, runner } = makeDeps({ plans: [makeDesign()] }, []);
    const state = stateAt('DESIGN');
    state.design = previous;
    await runDesign(deps, state);

    const input = runner.calls[0]!.input as PlanInput;
    expect(input.previousDesign).toEqual(previous);
    expect(input.requirements).toEqual(makeRequirements());
  });
});

describe('runReview', () => {
  it('user confirm -> BUILD พร้อม progress ของทุก task', async () => {
    const { deps, io } = makeDeps({ pm: [asking('สรุป design ให้ฟัง')] }, ['confirm']);
    const state = stateAt('REVIEW');
    state.design = makeDesign();
    await runReview(deps, state);

    expect(state.phase).toBe('BUILD');
    expect(state.progress.api).toEqual({ rounds: 0, maxRounds: 5, done: false, acceptedWithIssues: false });
    expect(Object.keys(state.progress)).toEqual(['api', 'ui']);
    expect(io.said.join('\n')).toContain('สรุป design ให้ฟัง');
    expect(io.said.join('\n')).toContain('ภาพรวมของระบบ');
  });

  it('user ขอแก้ -> กลับ REQUIREMENTS พร้อม pendingPrompt', async () => {
    const { deps } = makeDeps({ pm: [asking('สรุป')] }, ['revise', 'เพิ่มหน้า login']);
    const state = stateAt('REVIEW');
    state.design = makeDesign();
    await runReview(deps, state);

    expect(state.phase).toBe('REQUIREMENTS');
    expect(state.pendingPrompt).toBe('เพิ่มหน้า login');
  });

  it('เก็บ progress ที่เสร็จแล้วของ task ที่ไม่เปลี่ยน', async () => {
    const { deps } = makeDeps({ pm: [asking('สรุป')] }, ['confirm']);
    const state = stateAt('REVIEW');
    state.design = makeDesign([makeTask('api', 'backend', [], false), makeTask('ui', 'frontend', ['api'])]);
    state.progress = { api: { rounds: 2, maxRounds: 5, done: true, acceptedWithIssues: false } };
    await runReview(deps, state);

    expect(state.progress.api?.done).toBe(true);
    expect(state.progress.ui?.done).toBe(false);
  });

  it('askNonEmpty: empty/whitespace answers are re-asked, final answer is stored', async () => {
    const { deps } = makeDeps({ pm: [asking('สรุป')] }, ['revise', '', '  ', 'เพิ่มหน้า login']);
    const state = stateAt('REVIEW');
    state.design = makeDesign();
    await runReview(deps, state);

    expect(state.phase).toBe('REQUIREMENTS');
    expect(state.pendingPrompt).toBe('เพิ่มหน้า login');
  });
});
