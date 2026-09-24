import type { Deps } from '../deps';
import { isPass, isSecurityPass, orderTasks } from '../domain';
import { RoleRunError } from '../errors';
import { nullLogger } from '../logger';
import type { Design, QAReport, Requirements, Task } from '../schemas';
import type { State, TaskProgress } from '../state';

type Outcome = 'done' | 'aborted';
type Decision = 'continue' | 'accept' | 'abort';
interface BuildContext {
  design: Design;
  requirements: Requirements;
}

const LIMIT_SUBTYPES: readonly string[] = ['error_max_turns', 'error_max_budget_usd'];

type Step = 'work' | 'qa' | 'security';

function stepLabel(task: Task, step: Step): string {
  if (step === 'work') return `worker ${task.owner} (ขั้นทำงาน)`;
  if (step === 'qa') return 'QA (ขั้นตรวจงาน)';
  return 'Security (ขั้นตรวจความปลอดภัย)';
}

function stepSayName(task: Task, step: Step): string {
  if (step === 'work') return task.owner;
  if (step === 'qa') return 'QA';
  return 'Security';
}

function limitReport(task: Task, step: Step, subtype: string): QAReport {
  return {
    taskId: task.id,
    verdict: 'FAIL',
    checks: [],
    issues: [
      {
        severity: 'blocker',
        file: '',
        description: `${stepLabel(task, step)} ชนขีดจำกัดของ SDK (${subtype}) จึงยังไม่ได้ผลลัพธ์ของรอบนี้`,
        suggestedFix:
          'ลดขนาดงานของ task นี้ หรือเพิ่ม maxTurns/maxBudgetUsd ของ role ใน agent-team.config.json',
      },
    ],
    testsAdded: [],
  };
}

async function runRound(
  deps: Deps,
  ctx: BuildContext,
  task: Task,
  progress: TaskProgress,
): Promise<{ report: QAReport; limitHit: boolean; securityReviewed: boolean }> {
  const { runner, io } = deps;
  let step: Step = 'work';
  let qaReport: QAReport | undefined;
  try {
    const result = await runner.work({ task, ...ctx, previousReport: progress.lastReport });
    step = 'qa';
    qaReport = await runner.qa({ task, result, ...ctx });
    if (!isPass(qaReport)) return { report: qaReport, limitHit: false, securityReviewed: false };

    step = 'security';
    const securityReport = await runner.security({ task, result, ...ctx });
    const securityPassed = isSecurityPass(securityReport);
    (deps.log ?? nullLogger).log(securityPassed ? 'INFO' : 'WARN', 'security.report', {
      taskId: task.id,
      round: progress.rounds + 1,
      issues: securityReport.issues.length,
      blockers: securityReport.issues.filter((i) => i.severity === 'blocker').length,
      majors: securityReport.issues.filter((i) => i.severity === 'major').length,
    });
    io.say(
      `[Security] ${task.id}: ${securityPassed ? 'PASS' : 'FAIL'} (${securityReport.issues.length} issues)`,
    );
    if (securityPassed) return { report: qaReport, limitHit: false, securityReviewed: true };

    return {
      report: {
        ...qaReport,
        verdict: 'FAIL',
        issues: [
          ...qaReport.issues,
          ...securityReport.issues.map((i) => ({ ...i, description: `[Security] ${i.description}` })),
        ],
      },
      limitHit: false,
      securityReviewed: true,
    };
  } catch (e) {
    if (step === 'security' && qaReport) {
      // QA already passed this round; a security-step failure of ANY kind (SDK limit,
      // schema-retry exhaustion, or anything else) must not discard already-approved
      // work or force another full worker+QA round over an infra/advisory-role hiccup.
      // Degrade to "not reviewed this round" and let the round pass on QA's own merit.
      const reason = e instanceof RoleRunError && e.subtype !== undefined ? e.subtype : String(e);
      (deps.log ?? nullLogger).log('WARN', 'security.report_failed', {
        taskId: task.id,
        round: progress.rounds + 1,
        reason,
      });
      io.say(`[Security] ${task.id}: ตรวจไม่สำเร็จ (${reason}) — รอบนี้ผ่านโดยไม่มีผลตรวจความปลอดภัย`);
      return { report: qaReport, limitHit: false, securityReviewed: false };
    }
    if (e instanceof RoleRunError && e.subtype !== undefined && LIMIT_SUBTYPES.includes(e.subtype)) {
      const report = limitReport(task, step, e.subtype);
      io.say(`[${stepSayName(task, step)}] ${task.id}: ชนขีดจำกัด ${e.subtype} — นับเป็นรอบที่ไม่ผ่าน`);
      return { report, limitHit: true, securityReviewed: false };
    }
    throw e;
  }
}

export async function runBuild(deps: Deps, state: State): Promise<void> {
  const { design, requirements } = state;
  if (!design || !requirements) throw new Error('BUILD ต้องมี requirements และ design');
  const ctx: BuildContext = { design, requirements };

  for (const task of orderTasks(design.tasks)) {
    const progress = state.progress[task.id];
    if (!progress) throw new Error(`ไม่พบ progress ของ task ${task.id}`);
    if (progress.done) continue;
    if ((await buildTask(deps, state, ctx, task, progress)) === 'aborted') {
      state.phase = 'ABORTED';
      await deps.store.save(state);
      return;
    }
  }
  state.phase = 'DELIVER';
  await deps.store.save(state);
}

async function buildTask(
  deps: Deps,
  state: State,
  ctx: BuildContext,
  task: Task,
  progress: TaskProgress,
): Promise<Outcome> {
  const { io, store, config } = deps;
  for (;;) {
    while (progress.rounds < progress.maxRounds) {
      io.say(
        `[${task.owner}] ทำ task ${task.id}: ${task.title} (รอบที่ ${progress.rounds + 1}/${progress.maxRounds})`,
      );
      const { report, limitHit, securityReviewed } = await runRound(deps, ctx, task, progress);
      progress.rounds += 1;
      progress.lastReport = report;
      progress.securityReviewed = securityReviewed;
      await store.saveArtifact(`reports/${task.id}-round${progress.rounds}.json`, report);

      const passed = isPass(report);
      (deps.log ?? nullLogger).log(passed ? 'INFO' : 'WARN', 'qa.report', {
        taskId: task.id,
        owner: task.owner,
        round: progress.rounds,
        maxRounds: progress.maxRounds,
        passed,
        limitHit,
        verdict: report.verdict,
        issues: report.issues.length,
        blockers: report.issues.filter((i) => i.severity === 'blocker').length,
        majors: report.issues.filter((i) => i.severity === 'major').length,
        checks: Object.fromEntries(report.checks.map((c) => [c.name, c.status])),
      });
      if (!limitHit) {
        io.say(`[QA] ${task.id}: ${passed ? 'PASS' : 'FAIL'} (${report.issues.length} issues)`);
      }
      if (passed) {
        progress.done = true;
        await store.save(state);
        return 'done';
      }
      await store.save(state);
    }

    const decision = await escalate(deps, state, task, progress);
    (deps.log ?? nullLogger).log('INFO', 'escalate.decision', {
      taskId: task.id,
      rounds: progress.rounds,
      decision,
    });
    if (decision === 'abort') return 'aborted';
    if (decision === 'accept') {
      progress.done = true;
      progress.acceptedWithIssues = true;
      await store.save(state);
      return 'done';
    }
    progress.maxRounds += config.extraRoundsOnContinue;
    await store.save(state);
  }
}

async function escalate(
  deps: Deps,
  state: State,
  task: Task,
  progress: TaskProgress,
): Promise<Decision> {
  const { runner, io, config } = deps;
  const { turn, sessionId } = await runner.pmTurn({
    sessionId: state.pmSessionId,
    prompt:
      `task ${task.id} (${task.title}) ไม่ผ่าน QA ครบ ${progress.rounds} รอบแล้ว ` +
      `ปัญหาที่ค้าง:\n${JSON.stringify(progress.lastReport?.issues ?? [])}\n` +
      'สรุปให้ user ฟังเป็นภาษาไทยว่าค้างอะไร และอธิบายตัวเลือก: continue / accept / abort',
  });
  state.pmSessionId = sessionId;
  await deps.store.save(state);
  io.say(`\n[PM] ${turn.message}\n`);
  return io.choose(
    `task ${task.id} ไม่ผ่านครบ ${progress.rounds} รอบ (continue = ทำต่ออีก ${config.extraRoundsOnContinue} รอบ, accept = รับตามสภาพ, abort = ยกเลิก)`,
    ['continue', 'accept', 'abort'] as const,
  );
}
