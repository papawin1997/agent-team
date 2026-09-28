import { describe, expect, it } from 'vitest';
import type { PlanInput, QaInput, WorkInput } from '../../src/deps';
import { RoleOutputError, RoleRunError } from '../../src/errors';
import { initProgress, quickDesign } from '../../src/domain';
import { restoreBaseDesign } from '../../src/level';
import { MAX_WORKER_RESUMES, runBuild } from '../../src/phases/build';
import { runDesign } from '../../src/phases/design';
import type { SnapshotProvider } from '../../src/snapshot';
import {
  asking,
  buildState,
  failReport,
  failSecurityReport,
  makeDesign,
  makeQuickTask,
  makeRequirements,
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
    expect((pmCalls[1]!.input as { prompt: string }).prompt).toContain('ทำไมถึงไม่ผ่าน');
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

  it('งาน quick: ไม่เรียก Security และ securityReviewed = false', async () => {
    const design = quickDesign(makeRequirements(), makeQuickTask());
    const state = buildState(design);
    state.level = 'quick';
    state.progress = initProgress(design, {}, 2);
    const { deps, runner } = makeDeps({ qa: [passReport('quick')] }, []);
    await runBuild(deps, state);

    expect(runner.calls.map((c) => c.role)).toEqual(['frontend', 'qa']);
    expect(state.progress.quick).toMatchObject({ done: true, securityReviewed: false });
    expect(state.phase).toBe('DELIVER');
  });

  it('งาน quick ไม่ผ่านครบรอบ: เลือก full -> ยกระดับไป DESIGN และ log, ล้าง design/progress พร้อม feedback ให้ Planning', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const design = quickDesign(makeRequirements(), makeQuickTask());
    const state = buildState(design);
    state.level = 'quick';
    state.quickTask = makeQuickTask();
    state.progress = initProgress(design, {}, 2);
    const { deps, io } = makeDeps(
      { qa: [failReport('quick'), failReport('quick')], pm: [asking('ค้างเรื่อง X')] },
      ['full'],
    );
    deps.log = { log: (_level, event, data) => events.push({ event, data }) };
    await runBuild(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(state.quickTask).toBeUndefined();
    expect(state.design).toBeUndefined();
    expect(state.progress).toEqual({});
    expect(state.designFeedback).toContain(`ลองทำแบบ quick (task "${makeQuickTask().title}")`);
    expect(state.designFeedback).toContain('ผิด');
    expect(io.asked.at(-1)).toContain('full = ยกระดับเป็นแบบเต็ม');
    expect(events.find((e) => e.event === 'escalate.decision')?.data).toMatchObject({ decision: 'full' });
    expect(events.find((e) => e.event === 'level.decided')?.data).toMatchObject({ level: 'full', by: 'user' });

    // ต่อ: ไป DESIGN แล้ว Planning ต้องไม่เห็น design สังเคราะห์เดิมเป็น previousDesign แต่เห็น feedback ที่บอกปัญหาที่ค้าง
    const { deps: designDeps, runner: designRunner } = makeDeps({ plans: [makeDesign()] }, []);
    await runDesign(designDeps, state);

    const planInput = designRunner.calls[0]!.input as PlanInput;
    expect(planInput.previousDesign).toBeUndefined();
    expect(planInput.feedback).toContain('ลองทำแบบ quick');
  });

  it('งาน quick มี baseDesign (เคยเป็น full มาก่อน) ไม่ผ่านครบรอบ เลือก full: คืน design/progress จาก base แทนล้างทิ้ง', async () => {
    const fullDesign = makeDesign(); // tasks [api(backend), ui(frontend, depends on api)]
    const baseProgress = initProgress(fullDesign, {}, 5);
    baseProgress.api = { ...baseProgress.api!, done: true };
    baseProgress.ui = { ...baseProgress.ui!, done: true };
    const quickTask = makeQuickTask();
    const quickDsn = quickDesign(makeRequirements(), quickTask, fullDesign);
    const state = buildState(quickDsn);
    state.level = 'quick';
    state.quickTask = quickTask;
    state.progress = initProgress(quickDsn, {}, 2);
    state.baseDesign = fullDesign;
    state.baseProgress = baseProgress;
    const { deps, io } = makeDeps(
      { qa: [failReport('quick'), failReport('quick')], pm: [asking('ค้างเรื่อง X')] },
      ['full'],
    );
    await runBuild(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(state.design).toEqual(fullDesign);
    expect(state.progress).toEqual(baseProgress);
    expect(state.baseDesign).toBeUndefined();
    expect(state.baseProgress).toBeUndefined();
    expect(state.designFeedback).toContain('ลองทำแบบ quick');
    expect(io.asked.at(-1)).toContain('full = ยกระดับเป็นแบบเต็ม');

    // ต่อ: Planning ต้องเห็น design เดิม [api, ui] เป็น previousDesign ไม่ใช่ design สังเคราะห์ของ quick
    const { deps: designDeps, runner: designRunner } = makeDeps({ plans: [makeDesign()] }, []);
    await runDesign(designDeps, state);

    const planInput = designRunner.calls[0]!.input as PlanInput;
    expect(planInput.previousDesign?.tasks.map((t) => t.id)).toEqual(['api', 'ui']);
  });

  it('งาน quick: continue ที่ escalate เพิ่มรอบตาม quickMaxQaRounds ไม่ใช่ extraRoundsOnContinue', async () => {
    const design = quickDesign(makeRequirements(), makeQuickTask());
    const state = buildState(design);
    state.level = 'quick';
    state.progress = initProgress(design, {}, 2);
    const { deps, io } = makeDeps(
      { qa: [failReport('quick'), failReport('quick'), passReport('quick')], pm: [asking('ค้าง')] },
      ['continue'],
    );
    deps.config = { ...deps.config, extraRoundsOnContinue: 5, quickMaxQaRounds: 3 };
    await runBuild(deps, state);

    expect(io.asked.at(-1)).toContain('ทำต่ออีก 3 รอบ');
    expect(state.progress.quick?.maxRounds).toBe(5);
    expect(state.progress.quick?.done).toBe(true);
    expect(state.phase).toBe('DELIVER');
  });

  it('งาน full: ตัวเลือก escalate ไม่มี full', async () => {
    const state = buildState();
    state.progress = initProgress(state.design!, {}, 1);
    const { deps, io } = makeDeps({ qa: [failReport('api')], pm: [asking('ค้าง')] }, ['abort']);
    await runBuild(deps, state);
    expect(io.asked.at(-1)).not.toContain('full =');
    expect(state.phase).toBe('ABORTED');
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

const workInputs = (calls: { role: string; input: unknown }[]) =>
  calls.filter((c) => c.role === 'backend').map((c) => c.input as WorkInput);
const qaInputs = (calls: { role: string; input: unknown }[]) =>
  calls.filter((c) => c.role === 'qa').map((c) => c.input as QaInput);

/** snapshot ปลอม: คืน t1, t2, ... ตามลำดับ และ diff บอกคู่ที่ถูกขอ */
function fakeSnapshots(opts: { fail?: 'snapshot' | 'diff'; none?: boolean } = {}): SnapshotProvider & { taken: number } {
  const s = {
    taken: 0,
    async snapshot() {
      if (opts.none) return undefined;
      if (opts.fail === 'snapshot') throw new Error('git พัง');
      s.taken += 1;
      return `t${s.taken}`;
    },
    async diff(before: string, after: string) {
      if (opts.fail === 'diff') throw new Error('diff พัง');
      return { diff: `diff ${before}..${after}`, files: ['src/api.ts'], truncated: false };
    },
  };
  return s;
}

describe('runBuild: worker resume session', () => {
  it(`รอบ 1 เปิดใหม่, resume ติดกันได้ ${MAX_WORKER_RESUMES} ครั้ง แล้วเปิดใหม่และ resume ต่อ`, async () => {
    const { deps, runner } = makeDeps({ qa: [...fails('api', 4), passReport('api')] }, []);
    const state = buildState(single());
    await runBuild(deps, state);

    const resumes = workInputs(runner.calls).map((w) => w.resumeSessionId);
    // FakeRunner ให้ sessionId = api-s<ลำดับการเรียก work> และ resume ไม่เปลี่ยน session ของ fake เป็นตัวเดิม
    expect(resumes).toEqual([undefined, 'api-s1', 'api-s2', undefined, 'api-s4']);
    expect(state.progress.api?.done).toBe(true);
  });

  it('resume ส่ง previousReport ของรอบก่อนไปด้วย', async () => {
    const { deps, runner } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    await runBuild(deps, buildState(single()));
    const second = workInputs(runner.calls)[1]!;
    expect(second.resumeSessionId).toBe('api-s1');
    expect(second.previousReport?.verdict).toBe('FAIL');
  });

  it('resume ล้มด้วย error ทั่วไป → log worker.resume_failed แล้วเปิด session ใหม่ในรอบเดียวกัน', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const { deps, runner } = makeDeps(
      { qa: [failReport('api'), passReport('api')], work: [undefined, new Error('No conversation found')] },
      [],
    );
    deps.log = { log: (_l, event, data) => void events.push({ event, data }) };
    const state = buildState(single());
    await runBuild(deps, state);

    expect(workInputs(runner.calls).map((w) => w.resumeSessionId)).toEqual([undefined, 'api-s1', undefined]);
    expect(events.find((e) => e.event === 'worker.resume_failed')?.data).toMatchObject({ taskId: 'api', round: 2 });
    expect(state.progress.api?.rounds).toBe(2);
    expect(state.progress.api?.workerResumes).toBe(0);
  });

  it('worker ชน limit → ล้าง session รอบถัดไปเปิดใหม่', async () => {
    const { deps, runner } = makeDeps(
      { qa: [failReport('api'), passReport('api')], work: [undefined, new RoleRunError('backend: max', false, 'error_max_turns')] },
      [],
    );
    await runBuild(deps, buildState(single()));
    // รอบ 1 เปิดใหม่ (s1) QA FAIL; รอบ 2 resume s1 แต่ชน limit; รอบ 3 เปิดใหม่
    expect(workInputs(runner.calls).map((w) => w.resumeSessionId)).toEqual([undefined, 'api-s1', undefined]);
  });

  it('resume ล้มระหว่างถูก abort (deps.abortSignal.aborted) → โยนต่อ ไม่ fallback ไปเปิด session ใหม่', async () => {
    const controller = new AbortController();
    const { deps, runner } = makeDeps(
      { qa: [failReport('api'), passReport('api')], work: [undefined, new Error('aborted mid-flight')] },
      [],
    );
    deps.abortSignal = controller.signal;
    const state = buildState(single());
    controller.abort();
    await expect(runBuild(deps, state)).rejects.toThrow('aborted mid-flight');

    expect(workInputs(runner.calls).map((w) => w.resumeSessionId)).toEqual([undefined, 'api-s1']);
    expect(state.progress.api?.rounds).toBe(1);
  });

  it('resume ล้มด้วย error ทั่วไป (ไม่ได้ถูก abort) แล้ว fresh fallback ชน SDK limit: นับเป็นรอบเดียว, ล้าง session', async () => {
    const { deps, runner } = makeDeps(
      {
        qa: [failReport('api')],
        work: [
          undefined,
          new Error('resume broken'),
          new RoleRunError('backend: error_max_turns', false, 'error_max_turns'),
        ],
        pm: [asking('ค้าง')],
      },
      ['abort'],
    );
    const state = buildState(single());
    state.progress.api!.maxRounds = 2;
    await runBuild(deps, state);

    expect(workInputs(runner.calls).map((w) => w.resumeSessionId)).toEqual([undefined, 'api-s1', undefined]);
    expect(state.progress.api?.rounds).toBe(2);
    expect(state.progress.api?.lastRoundLimit).toBe(true);
    expect(state.progress.api).not.toHaveProperty('workerSessionId');
    expect(state.progress.api).not.toHaveProperty('workerResumes');
    expect(state.phase).toBe('ABORTED');
  });

  it('เก็บ workerSessionId/workerResumes ลง state (resume ข้าม process ได้)', async () => {
    const { deps, store } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    await runBuild(deps, buildState(single()));
    expect(store.state?.progress.api).toMatchObject({ workerSessionId: 'api-s2', workerResumes: 1 });
  });
});

describe('runBuild: QA ตรวจเฉพาะ diff ในรอบแก้', () => {
  it('รอบ 1 ตรวจทั้ง task; รอบแก้ได้ roundDiff จาก baseline (reviewedTree) ไปถึง tree ปัจจุบัน + previousReport', async () => {
    const { deps, runner } = makeDeps({ qa: [failReport('api'), failReport('api'), passReport('api')] }, []);
    const snaps = fakeSnapshots();
    deps.snapshots = snaps;
    const state = buildState(single());
    await runBuild(deps, state);

    const qa = qaInputs(runner.calls);
    expect(qa[0]!.roundDiff).toBeUndefined();
    // full: ไม่มี startTree (M6) รอบแรกเป็น full เสมอ ("after" รอบแรกคือ t1)
    // baseline = reviewedTree ของรอบก่อน (t1 หลังรอบ 1) ไม่ใช่ snapshot ที่ถ่ายตอนเริ่มรอบ 2
    expect(qa[1]!.roundDiff?.diff).toBe('diff t1..t2');
    expect(qa[1]!.previousReport?.verdict).toBe('FAIL');
    // รอบ 3 diff ต่อจาก reviewedTree ที่เพิ่งเลื่อนมาเป็น t2 (ไม่ใช่ t3..t4 แบบ snapshot ตอนเริ่มรอบ)
    expect(qa[2]!.roundDiff?.diff).toBe('diff t2..t3');
    // snapshot ต่อรอบ 1 ครั้ง (หลัง worker) เท่านั้น full ไม่ถ่าย startTree
    expect(snaps.taken).toBe(3);
    expect(state.progress.api?.reviewedTree).toBe('t3');
  });

  it('log qa.scope ทุกรอบ (full แล้ว diff)', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const { deps } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    deps.snapshots = fakeSnapshots();
    deps.log = { log: (_l, event, data) => void events.push({ event, data }) };
    await runBuild(deps, buildState(single()));
    expect(events.filter((e) => e.event === 'qa.scope').map((e) => e.data)).toEqual([
      { taskId: 'api', round: 1, mode: 'full' },
      { taskId: 'api', round: 2, mode: 'diff', files: 1, chars: 'diff t1..t2'.length, truncated: false },
    ]);
  });

  it.each([
    ['ไม่มี deps.snapshots', undefined],
    ['snapshot คืน undefined (ไม่ใช่ git repo)', fakeSnapshots({ none: true })],
    ['snapshot โยน error', fakeSnapshots({ fail: 'snapshot' })],
    ['diff โยน error', fakeSnapshots({ fail: 'diff' })],
  ])('%s → รอบแก้ตรวจทั้ง task และงานไม่ล้ม', async (_name, snaps) => {
    const { deps, runner } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    if (snaps) deps.snapshots = snaps;
    const state = buildState(single());
    await runBuild(deps, state);
    expect(qaInputs(runner.calls)[1]!.roundDiff).toBeUndefined();
    expect(state.progress.api?.done).toBe(true);
  });

  it('Security ไม่ได้รับ diff', async () => {
    const { deps, runner } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    deps.snapshots = fakeSnapshots();
    await runBuild(deps, buildState(single()));
    const security = runner.calls.filter((c) => c.role === 'security').map((c) => c.input as QaInput);
    expect(security).toHaveLength(1);
    expect(security[0]!.roundDiff).toBeUndefined();
  });

  it('เก็บ reviewedTree ลง store.state (baseline ของรอบแก้ถัดไป ข้าม process ได้)', async () => {
    const { deps, store } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    deps.snapshots = fakeSnapshots();
    await runBuild(deps, buildState(single()));
    // full ไม่ถ่าย startTree (M6): รอบ 1 after=t1 (full), รอบ 2 after=t2 diff(t1,t2) แล้ว reviewedTree=t2
    expect(store.state?.progress.api?.reviewedTree).toBe('t2');
  });

  it('งานที่ resume ข้าม process: progress มี reviewedTree + lastReport เดิมอยู่แล้ว รอบแรกของการรันใหม่ diff จาก reviewedTree ที่เก็บไว้', async () => {
    const { deps, runner } = makeDeps({ qa: [passReport('api')] }, []);
    deps.snapshots = fakeSnapshots();
    const state = buildState(single());
    state.progress.api = {
      rounds: 1,
      maxRounds: 5,
      done: false,
      acceptedWithIssues: false,
      securityReviewed: false,
      lastReport: failReport('api'),
      reviewedTree: 'stored-tree',
      workerSessionId: 'api-s1',
      workerResumes: 0,
    };
    await runBuild(deps, state);

    const qa = qaInputs(runner.calls);
    expect(qa[0]!.roundDiff?.diff).toBe('diff stored-tree..t1');
    expect(state.progress.api?.done).toBe(true);
  });

  it('QA ชนขีดจำกัด: รอบถัดไปตรวจทั้ง task (lastRoundLimit) และ worker ต้องเปิด session ใหม่ ไม่ resume แล้วรอบถัดจากนั้น diff จาก reviewedTree ล่าสุด', async () => {
    const { deps, runner } = makeDeps(
      {
        qa: [
          failReport('api'),
          new RoleRunError('qa: error_max_turns', false, 'error_max_turns'),
          failReport('api'),
          passReport('api'),
        ],
      },
      [],
    );
    deps.snapshots = fakeSnapshots();
    const state = buildState(single());
    await runBuild(deps, state);

    const qa = qaInputs(runner.calls);
    expect(qa).toHaveLength(4);
    // full ไม่ถ่าย startTree (M6): "after" ของรอบ 1 คือ t1
    expect(qa[0]!.roundDiff).toBeUndefined(); // รอบ 1: full (t1 = after รอบแรก ไม่มี baseline ให้ diff)
    expect(qa[1]!.roundDiff?.diff).toBe('diff t1..t2'); // รอบ 2 (ชน limit): ยัง diff จาก reviewedTree เดิม
    expect(qa[2]!.roundDiff).toBeUndefined(); // รอบ 3: รอบหลัง QA ชน limit บังคับ full
    expect(qa[3]!.roundDiff?.diff).toBe('diff t3..t4'); // รอบ 4: diff จาก reviewedTree ที่เลื่อนมาเป็นของรอบ 3

    expect(workInputs(runner.calls).map((w) => w.resumeSessionId)).toEqual([undefined, 'api-s1', undefined, 'api-s3']);
    expect(state.progress.api?.reviewedTree).toBe('t4');
    expect(state.progress.api?.done).toBe(true);
  });

  it('worker ชนขีดจำกัด: รอบถัดไปตรวจทั้ง task (lastRoundLimit) แม้ reviewedTree เดิมยังอยู่', async () => {
    const { deps, runner } = makeDeps(
      {
        work: [undefined, new RoleRunError('backend: error_max_turns', false, 'error_max_turns'), undefined, undefined],
        qa: [failReport('api'), failReport('api'), passReport('api')],
      },
      [],
    );
    deps.snapshots = fakeSnapshots();
    const state = buildState(single());
    await runBuild(deps, state);

    const qa = qaInputs(runner.calls);
    expect(qa).toHaveLength(3);
    // full ไม่ถ่าย startTree (M6): "after" ของรอบ 1 คือ t1
    expect(qa[0]!.roundDiff).toBeUndefined(); // รอบ 1: full (t1 = after รอบแรก ไม่มี baseline ให้ diff)
    expect(qa[1]!.roundDiff).toBeUndefined(); // รอบ 3: รอบหลัง worker ชน limit บังคับ full
    expect(qa[2]!.roundDiff?.diff).toBe('diff t2..t3'); // รอบ 4: diff จาก reviewedTree ที่เลื่อนมาเป็นของรอบ 3

    expect(workInputs(runner.calls).map((w) => w.resumeSessionId)).toEqual([undefined, 'api-s1', undefined, 'api-s3']);
    expect(state.progress.api?.done).toBe(true);
    expect(state.progress.api?.reviewedTree).toBe('t3');
  });
});

describe('restoreBaseDesign ล้าง session ของ worker', () => {
  it('progress ที่คืนจาก base ไม่มี workerSessionId/workerResumes', () => {
    const state = buildState(single());
    state.baseDesign = single();
    state.baseProgress = {
      api: {
        rounds: 2,
        maxRounds: 5,
        done: false,
        acceptedWithIssues: false,
        securityReviewed: false,
        workerSessionId: 'old',
        workerResumes: 1,
        touchedFiles: ['src/old.ts'],
      },
    };
    restoreBaseDesign(state);
    expect(state.progress.api).not.toHaveProperty('workerSessionId');
    expect(state.progress.api).not.toHaveProperty('workerResumes');
    // I2: touchedFiles เป็นของ task เดิมก่อนถูก escalate ต้องล้างด้วย ไม่งั้นไฟล์เก่าที่ไม่เกี่ยวข้องปนกับรอบใหม่
    expect(state.progress.api).not.toHaveProperty('touchedFiles');
  });
});

describe('runBuild: Security ตามไฟล์เสี่ยง (quick/standard)', () => {
  /** snapshot ปลอมที่ diff ระหว่าง startTree กับรอบล่าสุดคืนไฟล์ที่กำหนด */
  const snapsWithFiles = (files: string[], diff = '') => {
    let n = 0;
    return {
      snapshot: async () => `t${++n}`,
      diff: async () => ({ diff, files, truncated: false }),
    };
  };

  it('standard ไม่แตะไฟล์เสี่ยง: ไม่เรียก Security, log security.trigger none', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const { deps, runner } = makeDeps({ qa: [passReport('api')] }, []);
    deps.snapshots = snapsWithFiles(['src/components/Button.tsx']);
    deps.log = { log: (_l, event, data) => void events.push({ event, data }) };
    const state = { ...buildState(single()), level: 'standard' as const };
    await runBuild(deps, state);
    expect(roles(runner.calls)).toEqual(['backend', 'qa']);
    expect(state.progress.api?.securityReviewed).toBe(false);
    expect(events.find((e) => e.event === 'security.trigger')?.data).toMatchObject({ taskId: 'api', reason: 'none' });
  });

  it('standard แตะ src/auth/login.ts: เรียก Security พร้อมบอกเหตุผล', async () => {
    const { deps, runner, io } = makeDeps({ qa: [passReport('api')] }, []);
    deps.snapshots = snapsWithFiles(['src/auth/login.ts']);
    const state = { ...buildState(single()), level: 'standard' as const };
    await runBuild(deps, state);
    expect(roles(runner.calls)).toEqual(['backend', 'qa', 'security']);
    expect(io.said.join('\n')).toContain('ตรวจเพราะแตะ src/auth/login.ts (auth)');
  });

  it('quick: filesChanged ของ worker ก็นับ (ไม่มี snapshots)', async () => {
    const { deps, runner } = makeDeps({ qa: [passReport('quick')] }, []);
    const task = { ...makeTask('quick'), id: 'quick' };
    const state = { ...buildState(makeDesign([task])), level: 'quick' as const };
    // FakeRunner รายงาน filesChanged = ['src/quick.ts'] ซึ่งไม่เสี่ยง
    await runBuild(deps, state);
    expect(roles(runner.calls)).not.toContain('security');
  });

  it('เนื้อหา diff มีคำเสี่ยง (child_process) แม้ชื่อไฟล์ธรรมดา: เรียก Security', async () => {
    const { deps, runner } = makeDeps({ qa: [passReport('api')] }, []);
    deps.snapshots = snapsWithFiles(['src/tools/run.ts'], "+import { exec } from 'child_process';");
    const state = { ...buildState(single()), level: 'standard' as const };
    await runBuild(deps, state);
    expect(roles(runner.calls)).toContain('security');
  });

  it('full: เรียก Security ทุก task เหมือนเดิม และไม่เก็บ startTree (M6: startTree เฉพาะ quick/standard)', async () => {
    const { deps, runner } = makeDeps({ qa: [passReport('api')] }, []);
    deps.snapshots = snapsWithFiles(['README.md']);
    const state = buildState(single());
    await runBuild(deps, state);
    expect(roles(runner.calls)).toEqual(['backend', 'qa', 'security']);
    expect(state.progress.api?.startTree).toBeUndefined();
  });

  it('I1: startTree ถูก persist ลง store ก่อนเรียก worker รอบแรก (กัน resume หลัง crash เห็น startTree ที่มี edit ของ worker ติดมาด้วย)', async () => {
    const { deps, runner, store } = makeDeps({ qa: [passReport('api')] }, []);
    deps.snapshots = fakeSnapshots();
    let startTreeAtWorkCall: string | undefined;
    const originalWork = runner.work.bind(runner);
    runner.work = async (input) => {
      startTreeAtWorkCall = store.state?.progress.api?.startTree;
      return originalWork(input);
    };
    const state = { ...buildState(single()), level: 'standard' as const };
    await runBuild(deps, state);
    expect(startTreeAtWorkCall).toBe('t1');
    expect(state.progress.api?.done).toBe(true);
  });

  it('I2(a): ไม่มี snapshots — ไฟล์เสี่ยงที่ worker แก้ในรอบที่ QA ไม่ผ่านยังถูกนับสะสมตอนรอบถัดไปผ่าน', async () => {
    const { deps, runner } = makeDeps(
      { qa: [failReport('api'), passReport('api')], workFiles: [['.env'], ['src/util.ts']] },
      [],
    );
    const state = { ...buildState(single()), level: 'standard' as const };
    await runBuild(deps, state);
    // รอบ 2 เองไม่ได้แก้ไฟล์เสี่ยง (src/util.ts) แต่รอบ 1 ที่ QA ไม่ผ่านแก้ .env ไว้ — touchedFiles สะสมไว้ให้ตัดสิน Security ได้
    expect(roles(runner.calls)).toEqual(['backend', 'qa', 'backend', 'qa', 'security']);
  });

  it('I2(b): git diff สะสมตั้งแต่ startTree ยังจับไฟล์เสี่ยงได้เหมือนเดิม (cumulative diff proof ไม่ regress)', async () => {
    const { deps, runner } = makeDeps({ qa: [failReport('api'), passReport('api')] }, []);
    deps.snapshots = snapsWithFiles(['src/auth/login.ts']);
    const state = { ...buildState(single()), level: 'standard' as const };
    await runBuild(deps, state);
    expect(roles(runner.calls)).toContain('security');
  });

  describe('M4: เนื้อหา diff ที่ใช้ตรวจคำเสี่ยงเอาเฉพาะบรรทัดที่เพิ่มใหม่จากไฟล์ไม่ใช่เทสต์', () => {
    it('บรรทัดที่ถูกลบและบรรทัด context ไม่นับเป็นเนื้อหาเสี่ยง', async () => {
      const { deps, runner } = makeDeps({ qa: [passReport('api')] }, []);
      deps.snapshots = snapsWithFiles(
        ['src/tools/run.ts'],
        [
          'diff --git a/src/tools/run.ts b/src/tools/run.ts',
          '--- a/src/tools/run.ts',
          '+++ b/src/tools/run.ts',
          "-const cp = require('child_process');",
          ' context line เฉย ๆ',
        ].join('\n'),
      );
      const state = { ...buildState(single()), level: 'standard' as const };
      await runBuild(deps, state);
      expect(roles(runner.calls)).not.toContain('security');
    });

    it('ไฟล์เทสต์ไม่นับแม้บรรทัดที่เพิ่มใหม่มีคำเสี่ยง', async () => {
      const { deps, runner } = makeDeps({ qa: [passReport('api')] }, []);
      deps.snapshots = snapsWithFiles(
        ['tests/run.test.ts'],
        ['diff --git a/tests/run.test.ts b/tests/run.test.ts', '+++ b/tests/run.test.ts', "+const cp = require('child_process');"].join(
          '\n',
        ),
      );
      const state = { ...buildState(single()), level: 'standard' as const };
      await runBuild(deps, state);
      expect(roles(runner.calls)).not.toContain('security');
    });

    it('บรรทัดที่เพิ่มใหม่ในไฟล์ src มีคำเสี่ยง (child_process) → เรียก Security', async () => {
      const { deps, runner } = makeDeps({ qa: [passReport('api')] }, []);
      deps.snapshots = snapsWithFiles(
        ['src/tools/run.ts'],
        ['diff --git a/src/tools/run.ts b/src/tools/run.ts', '+++ b/src/tools/run.ts', "+import { exec } from 'child_process';"].join(
          '\n',
        ),
      );
      const state = { ...buildState(single()), level: 'standard' as const };
      await runBuild(deps, state);
      expect(roles(runner.calls)).toContain('security');
    });
  });

  describe('M9: ข้อความเหตุผลที่ Security ถูกเรียก', () => {
    it('มีแค่เนื้อหาเสี่ยง (ไม่มีไฟล์เสี่ยง): ไม่มีคำว่า "แตะ"', async () => {
      const { deps, io } = makeDeps({ qa: [passReport('api')] }, []);
      deps.snapshots = snapsWithFiles(
        ['src/tools/run.ts'],
        ['diff --git a/src/tools/run.ts b/src/tools/run.ts', '+++ b/src/tools/run.ts', "+import { exec } from 'child_process';"].join(
          '\n',
        ),
      );
      const state = { ...buildState(single()), level: 'standard' as const };
      await runBuild(deps, state);
      expect(io.said).toContain('[Security] api: ตรวจเพราะเนื้อหาเกี่ยวกับ shell');
    });

    it('มีทั้งไฟล์เสี่ยงและเนื้อหาเสี่ยง: ต่อกันด้วย " / "', async () => {
      const { deps, io } = makeDeps({ qa: [passReport('api')] }, []);
      deps.snapshots = snapsWithFiles(
        ['src/auth/login.ts'],
        [
          'diff --git a/src/auth/login.ts b/src/auth/login.ts',
          '+++ b/src/auth/login.ts',
          "+import { exec } from 'child_process';",
        ].join('\n'),
      );
      const state = { ...buildState(single()), level: 'standard' as const };
      await runBuild(deps, state);
      expect(io.said).toContain('[Security] api: ตรวจเพราะแตะ src/auth/login.ts (auth) / เนื้อหาเกี่ยวกับ shell');
    });
  });

  describe('M8: เทสต์ที่ยังขาด', () => {
    it('task แตะแค่ไฟล์เทสต์ (ไม่มีไฟล์อื่นเลย) → ไม่เรียก Security, reason none', async () => {
      const events: { event: string; data?: Record<string, unknown> }[] = [];
      const { deps, runner } = makeDeps(
        { qa: [passReport('api')], workFiles: [['src/auth/login.test.ts']] },
        [],
      );
      deps.log = { log: (_l, event, data) => void events.push({ event, data }) };
      const state = { ...buildState(single()), level: 'standard' as const };
      await runBuild(deps, state);
      expect(roles(runner.calls)).not.toContain('security');
      expect(events.find((e) => e.event === 'security.trigger')?.data).toMatchObject({ reason: 'none' });
    });

    it('มากกว่า 5 ไฟล์เสี่ยง: ตัดรายชื่อที่ 5 แล้วต่อด้วย ", …"', async () => {
      const files = [
        'src/auth/a.ts',
        'src/auth/b.ts',
        'src/auth/c.ts',
        'src/auth/d.ts',
        'src/auth/e.ts',
        'src/auth/f.ts',
      ];
      const { deps, io } = makeDeps({ qa: [passReport('api')], workFiles: [files] }, []);
      const state = { ...buildState(single()), level: 'standard' as const };
      await runBuild(deps, state);
      expect(io.said.join('\n')).toContain(', …');
    });

    it('standard: Security FAIL แล้ว worker แก้ในรอบใหม่ (ยังแตะไฟล์เสี่ยงเดิม) → Security ถูกเรียกอีกครั้ง', async () => {
      const { deps, runner } = makeDeps(
        {
          qa: [passReport('api'), passReport('api')],
          security: [failSecurityReport('api', 'blocker'), passSecurityReport('api')],
          workFiles: [['src/auth/login.ts'], ['src/auth/login.ts']],
        },
        [],
      );
      const state = { ...buildState(single()), level: 'standard' as const };
      await runBuild(deps, state);
      expect(roles(runner.calls).filter((r) => r === 'security')).toHaveLength(2);
      expect(state.progress.api?.done).toBe(true);
    });
  });
});

describe('runBuild: quick เสนอยกเป็น standard', () => {
  it('quick ไม่ผ่านครบรอบ เลือก standard → DESIGN ด้วย level standard, log by user', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const task = { ...makeTask('quick'), id: 'quick' };
    const { deps } = makeDeps(
      { qa: fails('quick', 2), pm: [asking('ค้าง 2 รอบ')] },
      ['standard'],
    );
    deps.log = { log: (_l, event, data) => void events.push({ event, data }) };
    const state = { ...buildState(makeDesign([task])), level: 'quick' as const };
    state.progress.quick = { ...state.progress.quick!, maxRounds: 2 };
    await runBuild(deps, state);
    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('standard');
    expect(state.designFeedback).toContain('ไม่ผ่าน QA');
    expect(events.find((e) => e.event === 'level.decided')?.data).toMatchObject({ level: 'standard', by: 'user' });
  });
});
