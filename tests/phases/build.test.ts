import { describe, expect, it } from 'vitest';
import type { WorkInput } from '../../src/deps';
import { RoleOutputError, RoleRunError } from '../../src/errors';
import { runBuild } from '../../src/phases/build';
import {
  asking,
  buildState,
  failReport,
  failSecurityReport,
  makeDesign,
  makeTask,
  passReport,
  passSecurityReport,
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
    expect(roles(runner.calls)).toEqual(['backend', 'qa', 'security', 'frontend', 'qa', 'security']);
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

  it('บันทึก log ผล QA ต่อรอบ และการตัดสินใจตอน escalate', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const { deps } = makeDeps(
      { pm: [asking('ค้าง')], qa: [failReport('api'), failReport('api'), passReport('api')] },
      ['continue'],
    );
    deps.config = { ...deps.config, maxQaRounds: 2 };
    deps.log = { log: (_level, event, data) => void events.push({ event, data: data as never }) };
    const state = buildState(single());
    state.progress.api = {
      rounds: 0,
      maxRounds: 2,
      done: false,
      acceptedWithIssues: false,
      securityReviewed: false,
    };
    await runBuild(deps, state);

    const rounds = events.filter((e) => e.event === 'qa.report').map((e) => [e.data.round, e.data.passed]);
    expect(rounds).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(events.find((e) => e.event === 'escalate.decision')?.data).toMatchObject({
      taskId: 'api',
      decision: 'continue',
    });
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
    state.progress.api = {
      rounds: 1,
      maxRounds: 5,
      done: true,
      acceptedWithIssues: false,
      securityReviewed: false,
    };
    await runBuild(deps, state);

    expect(roles(runner.calls)).toEqual(['frontend', 'qa', 'security']);
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
    const chooseOrText = io.chooseOrText.bind(io);
    io.chooseOrText = async (prompt, options) => {
      persistedWhenAsked = store.state?.pmSessionId;
      return chooseOrText(prompt, options);
    };
    await runBuild(deps, buildState(single()));

    expect(persistedWhenAsked).toBe('pm-session');
    expect(store.state?.pmSessionId).toBe('pm-session');
  });

  it('escalate: พิมพ์คำถามแทนการเลือก continue/accept/abort -> PM ตอบก่อน แล้วถามใหม่จนเลือกจริง', async () => {
    const { deps, runner, io } = makeDeps(
      { qa: fails('api', 5), pm: [asking('ค้าง 5 รอบ'), asking('เพราะ endpoint ยังไม่ครบตาม spec')] },
      ['ทำไมถึงไม่ผ่าน', 'abort'],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    expect(state.phase).toBe('ABORTED');
    const pmCalls = runner.calls.filter((c) => c.role === 'pm');
    expect(pmCalls).toHaveLength(2);
    expect((pmCalls[1]!.input as { prompt: string }).prompt).toBe('ทำไมถึงไม่ผ่าน');
    expect(io.said.join('\n')).toContain('เพราะ endpoint ยังไม่ครบตาม spec');
  });

  it('QA ผ่านแล้วเรียก security ต่อ: security ผ่านด้วย -> task done ปกติ', async () => {
    const { deps, runner } = makeDeps(
      { qa: [passReport('api')], security: [passSecurityReport('api')] },
      [],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    expect(roles(runner.calls)).toEqual(['backend', 'qa', 'security']);
    expect(state.progress.api?.done).toBe(true);
  });

  it('QA ไม่ผ่าน: ไม่เรียก security เลย (ประหยัด API call)', async () => {
    const { deps, runner } = makeDeps(
      { qa: [failReport('api'), passReport('api')], security: [passSecurityReport('api')] },
      [],
    );
    await runBuild(deps, buildState(single()));

    expect(roles(runner.calls)).toEqual(['backend', 'qa', 'backend', 'qa', 'security']);
  });

  it('QA ผ่านแต่ Security เจอ blocker: รอบนั้นไม่ผ่าน ใช้ progress.rounds เดิม ส่ง issue กลับให้ worker', async () => {
    const { deps, runner } = makeDeps(
      {
        qa: [passReport('api'), passReport('api')],
        security: [failSecurityReport('api', 'blocker'), passSecurityReport('api')],
      },
      [],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    expect(roles(runner.calls)).toEqual(['backend', 'qa', 'security', 'backend', 'qa', 'security']);
    expect(state.progress.api?.rounds).toBe(2);
    expect(state.progress.api?.done).toBe(true);
    const works = runner.calls.filter((c) => c.role === 'backend');
    expect((works[1]!.input as WorkInput).previousReport?.verdict).toBe('FAIL');
    expect((works[1]!.input as WorkInput).previousReport?.issues[0]?.description).toBe('[Security] มีช่องโหว่');
  });

  it('security ผ่าน: say "[Security] ... PASS" และ log event security.report แบบ INFO', async () => {
    const events: Array<{ level: string; event: string; data: Record<string, unknown> }> = [];
    const { deps, io } = makeDeps({ qa: [passReport('api')], security: [passSecurityReport('api')] }, []);
    deps.log = { log: (level, event, data) => void events.push({ level, event, data: data as never }) };
    const state = buildState(single());
    await runBuild(deps, state);

    expect(io.said).toContain('[Security] api: PASS (0 issues)');
    const securityEvents = events.filter((e) => e.event === 'security.report');
    expect(securityEvents).toHaveLength(1);
    expect(securityEvents[0]).toMatchObject({
      level: 'INFO',
      data: { taskId: 'api', round: 1, issues: 0, blockers: 0, majors: 0 },
    });
    expect(state.progress.api?.securityReviewed).toBe(true);
  });

  it('security เจอ blocker: say "[Security] ... FAIL", log event security.report แบบ WARN พร้อม blockers/majors และ artifact ของรอบนั้นมี issue ของ security', async () => {
    const events: Array<{ level: string; event: string; data: Record<string, unknown> }> = [];
    const { deps, io, store } = makeDeps(
      {
        qa: [passReport('api'), passReport('api')],
        security: [failSecurityReport('api', 'blocker'), passSecurityReport('api')],
      },
      [],
    );
    deps.log = { log: (level, event, data) => void events.push({ level, event, data: data as never }) };
    const state = buildState(single());
    await runBuild(deps, state);

    expect(io.said).toContain('[Security] api: FAIL (1 issues)');
    const securityEvents = events.filter((e) => e.event === 'security.report');
    expect(securityEvents[0]).toMatchObject({
      level: 'WARN',
      data: { taskId: 'api', round: 1, issues: 1, blockers: 1, majors: 0 },
    });

    const artifact = store.artifacts.get('reports/api-round1.json') as { issues: unknown[] };
    expect(artifact.issues).toEqual(
      failSecurityReport('api', 'blocker').issues.map((i) => ({ ...i, description: `[Security] ${i.description}` })),
    );
    expect(state.progress.api?.securityReviewed).toBe(true);
  });

  it('security ชน error_max_turns หลัง QA ผ่าน: ไม่ทิ้ง qaReport เดิม รอบนั้นผ่านเลยโดยไม่มีผลตรวจ security', async () => {
    const { deps, runner, io } = makeDeps(
      {
        qa: [passReport('api')],
        security: [new RoleRunError('security: error_max_turns', false, 'error_max_turns')],
      },
      [],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    expect(runner.calls.filter((c) => c.role === 'backend')).toHaveLength(1);
    expect(state.progress.api?.rounds).toBe(1);
    expect(state.progress.api?.done).toBe(true);
    expect(state.progress.api?.securityReviewed).toBe(false);
    expect(
      io.said.some((s) => s.includes('[Security]') && s.includes('ตรวจไม่สำเร็จ') && s.includes('error_max_turns')),
    ).toBe(true);
  });

  it('security โยน error ที่ไม่ใช่ SDK limit (เช่น RoleOutputError) หลัง QA ผ่าน: ไม่ทำให้ runBuild พัง', async () => {
    const { deps, runner } = makeDeps(
      {
        qa: [passReport('api')],
        security: [new RoleOutputError('security: schema ผิดซ้ำ')],
      },
      [],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    expect(runner.calls.filter((c) => c.role === 'backend')).toHaveLength(1);
    expect(state.progress.api?.done).toBe(true);
    expect(state.progress.api?.securityReviewed).toBe(false);
    expect(state.progress.api?.rounds).toBe(1);
  });

  it('security ชนขีดจำกัดหลัง QA ผ่าน: log event security.report_failed แบบ WARN', async () => {
    const events: Array<{ level: string; event: string; data: Record<string, unknown> }> = [];
    const { deps } = makeDeps(
      {
        qa: [passReport('api')],
        security: [new RoleRunError('security: error_max_turns', false, 'error_max_turns')],
      },
      [],
    );
    deps.log = { log: (level, event, data) => void events.push({ level, event, data: data as never }) };
    const state = buildState(single());
    await runBuild(deps, state);

    const failedEvents = events.filter((e) => e.event === 'security.report_failed');
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({
      level: 'WARN',
      data: { taskId: 'api', round: 1, reason: 'error_max_turns' },
    });
  });
});

describe('runBuild: SDK limit errors นับเป็นรอบที่ไม่ผ่าน', () => {
  it('worker ชน error_max_turns: นับ 1 รอบ, รอบถัดไปได้ synthetic report เป็น previousReport และเก็บ artifact', async () => {
    const { deps, runner, store } = makeDeps(
      { work: [new RoleRunError('backend: error_max_turns', false, 'error_max_turns')], qa: [passReport('api')] },
      [],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    const works = runner.calls.filter((c) => c.role === 'backend');
    expect(works).toHaveLength(2);
    expect(roles(runner.calls)).toEqual(['backend', 'backend', 'qa', 'security']);
    const previous = (works[1]!.input as WorkInput).previousReport;
    expect(previous?.taskId).toBe('api');
    expect(previous?.verdict).toBe('FAIL');
    expect(previous?.checks).toEqual([]);
    expect(previous?.testsAdded).toEqual([]);
    expect(previous?.issues).toHaveLength(1);
    expect(previous?.issues[0]?.severity).toBe('blocker');
    expect(previous?.issues[0]?.file).toBe('');
    expect(previous?.issues[0]?.description).toContain('backend');
    expect(previous?.issues[0]?.description).toContain('error_max_turns');
    expect(previous?.issues[0]?.suggestedFix).toBe(
      'ลดขนาดงานของ task นี้ หรือเพิ่ม maxTurns/maxBudgetUsd ของ role ใน agent-team.config.json',
    );
    const artifact = store.artifacts.get('reports/api-round1.json') as { verdict: string };
    expect(artifact.verdict).toBe('FAIL');
    expect(state.progress.api?.rounds).toBe(2);
    expect(state.progress.api?.done).toBe(true);
    expect(state.phase).toBe('DELIVER');
  });

  it('QA ชน error_max_budget_usd: นับ 1 รอบ แล้วรอบถัดไปได้ synthetic report ที่ระบุ qa', async () => {
    const { deps, runner, store } = makeDeps(
      {
        qa: [new RoleRunError('qa: error_max_budget_usd', false, 'error_max_budget_usd'), passReport('api')],
      },
      [],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    const works = runner.calls.filter((c) => c.role === 'backend');
    expect(works).toHaveLength(2);
    const previous = (works[1]!.input as WorkInput).previousReport;
    expect(previous?.verdict).toBe('FAIL');
    expect(previous?.issues[0]?.description).toContain('QA');
    expect(previous?.issues[0]?.description).toContain('error_max_budget_usd');
    expect((store.artifacts.get('reports/api-round1.json') as { verdict: string }).verdict).toBe('FAIL');
    expect(state.progress.api?.rounds).toBe(2);
    expect(store.state?.progress.api?.rounds).toBe(2);
  });

  it('ชน limit ครบ 5 รอบ: ถาม escalation เหมือน QA FAIL 5 รอบ', async () => {
    const limit = () => new RoleRunError('backend: error_max_turns', false, 'error_max_turns');
    const { deps, runner, io } = makeDeps(
      { work: [limit(), limit(), limit(), limit(), limit()], pm: [asking('ค้าง 5 รอบ')] },
      ['abort'],
    );
    const state = buildState(single());
    await runBuild(deps, state);

    expect(state.phase).toBe('ABORTED');
    expect(state.progress.api?.rounds).toBe(5);
    expect(state.progress.api?.done).toBe(false);
    expect(runner.calls.filter((c) => c.role === 'backend')).toHaveLength(5);
    expect(runner.calls.filter((c) => c.role === 'qa')).toHaveLength(0);
    expect(runner.calls.filter((c) => c.role === 'pm')).toHaveLength(1);
    expect(io.asked.filter((q) => q.includes('ไม่ผ่านครบ 5 รอบ'))).toHaveLength(1);
    expect(io.asked).toHaveLength(1);
  });

  const propagating: Array<[string, () => Error, 'work' | 'qa']> = [
    ['RoleOutputError (work)', () => new RoleOutputError('schema ผิดซ้ำ'), 'work'],
    ['RoleOutputError (qa)', () => new RoleOutputError('schema ผิดซ้ำ'), 'qa'],
    ['RoleRunError retryable', () => new RoleRunError('x', true, 'error_during_execution'), 'work'],
    [
      'error_max_structured_output_retries',
      () => new RoleRunError('x', false, 'error_max_structured_output_retries'),
      'qa',
    ],
    ['RoleRunError ไม่มี subtype', () => new RoleRunError('x', false), 'work'],
    ['Error ธรรมดา', () => new Error('boom'), 'work'],
  ];
  it.each(propagating)('%s: propagate ออกจาก runBuild โดยไม่นับรอบ', async (_name, makeError, where) => {
    const script = where === 'work' ? { work: [makeError()] } : { qa: [makeError()] };
    const { deps, store } = makeDeps(script, []);
    const state = buildState(single());
    await expect(runBuild(deps, state)).rejects.toThrow(makeError().message);

    expect(state.progress.api?.rounds).toBe(0);
    expect(state.progress.api?.lastReport).toBeUndefined();
    expect(store.artifacts.has('reports/api-round1.json')).toBe(false);
    expect(state.phase).toBe('BUILD');
  });
});
