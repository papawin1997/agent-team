import { describe, expect, it } from 'vitest';
import type { WorkInput } from '../../src/deps';
import { runBuild } from '../../src/phases/build';
import {
  asking,
  buildState,
  failReport,
  makeDesign,
  makeTask,
  passReport,
} from '../helpers/builders';
import { makeDeps } from '../helpers/fakes';

const single = () => makeDesign([makeTask('api')]);
const roles = (calls: { role: string }[]) => calls.map((c) => c.role);
const fails = (taskId: string, n: number) => Array.from({ length: n }, () => failReport(taskId));

describe('runBuild', () => {
  it('ทำทีละ task ตาม dependsOn (backend ก่อน frontend) แล้วไป DELIVER', async () => {
    const { deps, runner, store } = makeDeps({ qa: [passReport('api'), passReport('ui')] }, []);
    const state = buildState();
    await runBuild(deps, state);

    expect(state.phase).toBe('DELIVER');
    expect(roles(runner.calls)).toEqual(['backend', 'qa', 'frontend', 'qa']);
    expect(state.progress.api?.done).toBe(true);
    expect(state.progress.ui?.done).toBe(true);
    expect(store.artifacts.has('reports/api-round1.json')).toBe(true);
  });

  it('QA ไม่ผ่าน: worker แก้ใหม่พร้อมรายการปัญหา แล้วผ่านรอบที่ 2', async () => {
    const { deps, runner } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    const state = buildState(single());
    await runBuild(deps, state);

    const works = runner.calls.filter((c) => c.role === 'backend');
    expect(works).toHaveLength(2);
    expect((works[0]!.input as WorkInput).previousReport).toBeUndefined();
    expect((works[1]!.input as WorkInput).previousReport?.issues[0]?.description).toBe('ผิด');
    expect(state.progress.api?.rounds).toBe(2);
    expect(state.phase).toBe('DELIVER');
  });

  it('QA ให้ PASS แต่มี blocker: นับว่าไม่ผ่าน', async () => {
    const sneaky = { ...passReport('api'), issues: failReport('api', 'blocker').issues };
    const { deps, runner } = makeDeps({ qa: [sneaky, passReport('api')] }, []);
    await runBuild(deps, buildState(single()));

    expect(runner.calls.filter((c) => c.role === 'backend')).toHaveLength(2);
  });

  it('ครบ 5 รอบยังไม่ผ่าน + user เลือก abort -> ABORTED', async () => {
    const { deps, runner } = makeDeps({ qa: fails('api', 5), pm: [asking('ค้าง 5 รอบ')] }, ['abort']);
    const state = buildState(single());
    await runBuild(deps, state);

    expect(state.phase).toBe('ABORTED');
    expect(runner.calls.filter((c) => c.role === 'backend')).toHaveLength(5);
    expect(runner.calls.filter((c) => c.role === 'pm')).toHaveLength(1);
    expect(state.progress.api?.done).toBe(false);
  });

  it('ครบ 5 รอบ + continue -> ทำต่ออีก 5 รอบ (maxRounds = 10) แล้วผ่านรอบที่ 6', async () => {
    const { deps, runner } = makeDeps(
      { qa: [...fails('api', 5), passReport('api')], pm: [asking('ค้าง')] },
      ['continue'],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    expect(runner.calls.filter((c) => c.role === 'backend')).toHaveLength(6);
    expect(state.progress.api?.maxRounds).toBe(10);
    expect(state.progress.api?.done).toBe(true);
    expect(state.phase).toBe('DELIVER');
  });

  it('ครบ 5 รอบ + accept -> ปิด task แบบรับตามสภาพ', async () => {
    const { deps } = makeDeps({ qa: fails('api', 5), pm: [asking('ค้าง')] }, ['accept']);
    const state = buildState(single());
    await runBuild(deps, state);

    expect(state.progress.api?.done).toBe(true);
    expect(state.progress.api?.acceptedWithIssues).toBe(true);
    expect(state.phase).toBe('DELIVER');
  });

  it('ข้าม task ที่เสร็จแล้ว (resume)', async () => {
    const { deps, runner } = makeDeps({ qa: [passReport('ui')] }, []);
    const state = buildState();
    state.progress.api = { rounds: 1, maxRounds: 5, done: true, acceptedWithIssues: false };
    await runBuild(deps, state);

    expect(roles(runner.calls)).toEqual(['frontend', 'qa']);
  });

  it('บันทึก state ทุกรอบ เพื่อให้ resume ได้', async () => {
    const { deps, store } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    await runBuild(deps, buildState(single()));

    expect(store.saves).toBeGreaterThanOrEqual(3);
    expect(store.state?.progress.api?.rounds).toBe(2);
  });

  it('จำกัด 5 รอบพอดีสำหรับ task ใหม่: worker 5 ครั้ง, QA 5 ครั้ง แล้วถาม user ครั้งเดียว', async () => {
    const { deps, runner, io } = makeDeps({ qa: fails('api', 5), pm: [asking('ค้าง 5 รอบ')] }, ['abort']);
    const state = buildState(single());
    await runBuild(deps, state);

    expect(runner.calls.filter((c) => c.role === 'backend')).toHaveLength(5);
    expect(runner.calls.filter((c) => c.role === 'qa')).toHaveLength(5);
    expect(state.progress.api?.rounds).toBe(5);
    expect(state.progress.api?.maxRounds).toBe(5);
    const escalations = io.asked.filter((q) => q.includes('ไม่ผ่านครบ 5 รอบ'));
    expect(escalations).toHaveLength(1);
    expect(io.asked).toHaveLength(1);
  });

  it('escalate บันทึก pmSessionId ลง store ก่อนถาม user', async () => {
    const { deps, io, store } = makeDeps({ qa: fails('api', 5), pm: [asking('ค้าง')] }, ['abort']);
    let persistedWhenAsked: string | undefined;
    const choose = io.choose.bind(io);
    io.choose = async (prompt, options) => {
      persistedWhenAsked = store.state?.pmSessionId;
      return choose(prompt, options);
    };
    await runBuild(deps, buildState(single()));

    expect(persistedWhenAsked).toBe('pm-session');
    expect(store.state?.pmSessionId).toBe('pm-session');
  });
});
