import { describe, expect, it } from 'vitest';
import type { PlanInput, SecurityDesignInput } from '../../src/deps';
import { DesignError } from '../../src/domain';
import { RoleRunError } from '../../src/errors';
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
  it('ได้ design ที่ถูกต้อง -> REVIEW และบันทึก design.json (พร้อม securityNotes)', async () => {
    const design = makeDesign();
    const { deps, store } = makeDeps({ plans: [design], securityDesign: [['เก็บ password แบบ hash']] }, []);
    const state = stateAt('DESIGN');
    await runDesign(deps, state);

    expect(state.phase).toBe('REVIEW');
    expect(state.design).toEqual({ ...design, securityNotes: ['เก็บ password แบบ hash'] });
    expect(store.artifacts.get('design.json')).toEqual({ ...design, securityNotes: ['เก็บ password แบบ hash'] });
  });

  it('design วน dependency: ส่ง feedback ให้ Planning แล้วได้ design ใหม่', async () => {
    const cyclic = makeDesign([makeTask('a', 'backend', ['b']), makeTask('b', 'backend', ['a'])]);
    const good = makeDesign();
    const { deps, runner } = makeDeps({ plans: [cyclic, good] }, []);
    const state = stateAt('DESIGN');
    await runDesign(deps, state);

    expect(state.design).toEqual({ ...good, securityNotes: [] });
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

  it('เรียก security ตรวจ design ก่อนเข้า REVIEW โดยส่ง design และ requirements', async () => {
    const { deps, runner } = makeDeps({ plans: [makeDesign()], securityDesign: [['ข้อควรระวัง']] }, []);
    await runDesign(deps, stateAt('DESIGN'));

    const call = runner.calls.find((c) => c.role === 'security');
    expect(call).toBeDefined();
    expect((call!.input as SecurityDesignInput).requirements).toEqual(makeRequirements());
  });

  it('security ตรวจ design พังไม่ทำให้ phase ทั้งหมดพัง: securityNotes เป็น undefined (ไม่ใช่ [] ที่อ่านว่า "ไม่มีปัญหา") และเตือน user', async () => {
    const design = makeDesign();
    const { deps, io } = makeDeps(
      { plans: [design], securityDesign: [new RoleRunError('security: error_max_turns', false, 'error_max_turns')] },
      [],
    );
    const state = stateAt('DESIGN');
    await runDesign(deps, state);

    expect(state.phase).toBe('REVIEW');
    expect(state.design).toEqual({ ...design, securityNotes: undefined });
    expect(io.said.some((s) => s.includes('[Security]') && s.includes('ตรวจ design ไม่สำเร็จ'))).toBe(true);
  });
});

describe('runDesign: designFeedback (คำขอแก้ design จาก user)', () => {
  const cyclic = () => makeDesign([makeTask('a', 'backend', ['b']), makeTask('b', 'backend', ['a'])]);

  it('ไม่มี designFeedback: call แรกของ Planning ไม่มี feedback', async () => {
    const { deps, runner } = makeDeps({ plans: [makeDesign()] }, []);
    await runDesign(deps, stateAt('DESIGN'));
    expect((runner.calls[0]!.input as PlanInput).feedback).toBeUndefined();
  });

  it('call แรกของ Planning ได้ designFeedback เป็น feedback', async () => {
    const { deps, runner } = makeDeps({ plans: [makeDesign()] }, []);
    const state = stateAt('DESIGN');
    state.designFeedback = 'เพิ่มหน้า login';
    await runDesign(deps, state);

    expect((runner.calls[0]!.input as PlanInput).feedback).toBe('เพิ่มหน้า login');
  });

  it('ได้ design ที่ถูกต้อง -> ล้าง designFeedback ทั้งใน state และที่บันทึก', async () => {
    const { deps, store } = makeDeps({ plans: [makeDesign()] }, []);
    const state = stateAt('DESIGN');
    state.designFeedback = 'เพิ่มหน้า login';
    await runDesign(deps, state);

    expect(state.phase).toBe('REVIEW');
    expect(state.designFeedback).toBeUndefined();
    expect(store.state?.designFeedback).toBeUndefined();
  });

  it('DesignError รอบแรก: retry ได้ทั้ง designFeedback และข้อความ DesignError', async () => {
    const { deps, runner } = makeDeps({ plans: [cyclic(), makeDesign()] }, []);
    const state = stateAt('DESIGN');
    state.designFeedback = 'เพิ่มหน้า login';
    await runDesign(deps, state);

    expect((runner.calls[0]!.input as PlanInput).feedback).toBe('เพิ่มหน้า login');
    const retry = (runner.calls[1]!.input as PlanInput).feedback;
    expect(retry).toContain('เพิ่มหน้า login');
    expect(retry).toContain('dependency วน');
    expect(state.designFeedback).toBeUndefined();
  });

  it('design ผิดซ้ำ 2 ครั้ง: ยังเก็บ designFeedback ไว้ (ยังไม่ได้ design ที่ใช้ได้)', async () => {
    const { deps } = makeDeps({ plans: [cyclic(), cyclic()] }, []);
    const state = stateAt('DESIGN');
    state.designFeedback = 'เพิ่มหน้า login';
    await expect(runDesign(deps, state)).rejects.toThrow(DesignError);

    expect(state.designFeedback).toBe('เพิ่มหน้า login');
  });
});

describe('runReview', () => {
  it('user confirm -> BUILD พร้อม progress ของทุก task', async () => {
    const { deps, io } = makeDeps({ pm: [asking('สรุป design ให้ฟัง')] }, ['confirm']);
    const state = stateAt('REVIEW');
    state.design = makeDesign();
    await runReview(deps, state);

    expect(state.phase).toBe('BUILD');
    expect(state.progress.api).toEqual({
      rounds: 0,
      maxRounds: 5,
      done: false,
      acceptedWithIssues: false,
      securityReviewed: false,
    });
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
    state.progress = {
      api: { rounds: 2, maxRounds: 5, done: true, acceptedWithIssues: false, securityReviewed: false },
    };
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

  it('บันทึก pmSessionId ลง store ก่อนถาม user', async () => {
    const { deps, io, store } = makeDeps({ pm: [asking('สรุป')] }, ['confirm']);
    let persistedWhenAsked: string | undefined;
    const choose = io.choose.bind(io);
    io.choose = async (prompt, options) => {
      persistedWhenAsked = store.state?.pmSessionId;
      return choose(prompt, options);
    };
    const state = stateAt('REVIEW');
    state.design = makeDesign();
    await runReview(deps, state);

    expect(persistedWhenAsked).toBe('pm-session');
    expect(store.state?.pmSessionId).toBe('pm-session');
  });

  it('user ขอแก้ -> เก็บข้อความเดียวกันใน designFeedback และบันทึกลง store', async () => {
    const { deps, store } = makeDeps({ pm: [asking('สรุป')] }, ['revise', 'เพิ่มหน้า login']);
    const state = stateAt('REVIEW');
    state.design = makeDesign();
    await runReview(deps, state);

    expect(state.pendingPrompt).toBe('เพิ่มหน้า login');
    expect(state.designFeedback).toBe('เพิ่มหน้า login');
    expect(store.state?.designFeedback).toBe('เพิ่มหน้า login');
  });

  it('user confirm -> ไม่ตั้ง designFeedback', async () => {
    const { deps } = makeDeps({ pm: [asking('สรุป')] }, ['confirm']);
    const state = stateAt('REVIEW');
    state.design = makeDesign();
    await runReview(deps, state);

    expect(state.designFeedback).toBeUndefined();
  });
});
