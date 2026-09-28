import type { Deps } from '../deps';
import { decide } from '../io-util';
import { isPass, isSecurityPass, orderTasks } from '../domain';
import { RoleRunError } from '../errors';
import { escalateLevel } from '../level';
import { nullLogger } from '../logger';
import { riskFlags } from '../risk';
import { riskyFiles } from '../risk-files';
import type { Design, QAReport, Requirements, Task, WorkerResult } from '../schemas';
import type { RoundDiff } from '../snapshot';
import type { State, TaskProgress } from '../state';

type Outcome = 'done' | 'aborted' | 'escalated';
type Decision = 'continue' | 'accept' | 'abort' | 'standard' | 'full';
interface BuildContext {
  design: Design;
  requirements: Requirements;
}

/** จำนวนไฟล์เสี่ยงสูงสุดที่บอกชื่อใน io.say ก่อนตัดเป็น "..." */
const MAX_LISTED_FILES = 5;

interface SecurityDecision {
  run: boolean;
  reason: 'level' | 'risky-files' | 'none';
  files: string[];
  categories: string[];
  note?: string;
}

const LIMIT_SUBTYPES: readonly string[] = ['error_max_turns', 'error_max_budget_usd'];

/** resume session เดิมของ worker ติดกันได้กี่ครั้ง ก่อนบังคับเปิดใหม่ด้วย prompt เต็ม (กัน context บวม/วนกับแนวคิดผิด) */
export const MAX_WORKER_RESUMES = 2;

const errReason = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const isLimitError = (e: unknown): boolean =>
  e instanceof RoleRunError && e.subtype !== undefined && LIMIT_SUBTYPES.includes(e.subtype);

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

/** snapshot แบบไม่ทำให้รอบล้ม: error = log แล้วถือว่าไม่มี snapshot (QA ตรวจทั้ง task) */
async function trySnapshot(deps: Deps, task: Task, round: number): Promise<string | undefined> {
  if (!deps.snapshots) return undefined;
  try {
    return await deps.snapshots.snapshot();
  } catch (e) {
    (deps.log ?? nullLogger).log('WARN', 'snapshot.failed', { taskId: task.id, round, reason: errReason(e) });
    return undefined;
  }
}

/** diff ระหว่าง tree สอง snapshot error = log snapshot.failed แล้วถือว่าไม่มี diff (QA ตรวจทั้ง task) */
async function tryDiff(deps: Deps, task: Task, round: number, before: string, after: string): Promise<RoundDiff | undefined> {
  if (!deps.snapshots) return undefined;
  try {
    return await deps.snapshots.diff(before, after);
  } catch (e) {
    (deps.log ?? nullLogger).log('WARN', 'snapshot.failed', { taskId: task.id, round, reason: errReason(e) });
    return undefined;
  }
}

/** ตั้ง baseline ของ diff รอบถัดไปเป็น tree ที่ QA เพิ่งตรวจจริง (after ไม่มีค่า = ลบทิ้ง ให้รอบถัดไปตรวจทั้ง task) */
function updateReviewedTree(progress: TaskProgress, after: string | undefined): void {
  if (after === undefined) delete progress.reviewedTree;
  else progress.reviewedTree = after;
}

/**
 * ตัดสินว่า task นี้ (รอบนี้) ต้องให้ Security ตรวจไหม: full (หรือไม่มี level) = ตรวจทุก task เหมือนเดิม
 * quick/standard = ตรวจเฉพาะ task ที่แตะไฟล์เสี่ยง (riskyFiles จากไฟล์ที่ worker รายงาน + ไฟล์ที่ diff เจอ
 * ตั้งแต่ startTree ถึง after ของรอบนี้ ไม่นับไฟล์เทสต์) หรือเนื้อหา diff มีคำเสี่ยง (riskFlags)
 */
async function decideSecurity(
  deps: Deps,
  state: State,
  task: Task,
  progress: TaskProgress,
  round: number,
  result: WorkerResult,
  after: string | undefined,
): Promise<SecurityDecision> {
  if (state.level !== 'quick' && state.level !== 'standard') {
    return { run: true, reason: 'level', files: [], categories: [] };
  }
  const taskDiff =
    progress.startTree !== undefined && after !== undefined
      ? await tryDiff(deps, task, round, progress.startTree, after)
      : undefined;
  const files = [...new Set([...result.filesChanged, ...(taskDiff?.files ?? [])])];
  const risky = riskyFiles(files);
  const contentFlags = riskFlags(taskDiff?.diff ?? '');
  if (risky.length === 0 && contentFlags.length === 0) {
    return { run: false, reason: 'none', files: [], categories: [] };
  }
  const listed = risky
    .slice(0, MAX_LISTED_FILES)
    .map((r) => `${r.file} (${r.category})`)
    .join(', ');
  const more = risky.length > MAX_LISTED_FILES ? ', …' : '';
  const content = contentFlags.length ? `${listed ? ' / ' : ''}เนื้อหาเกี่ยวกับ ${contentFlags.join(', ')}` : '';
  return {
    run: true,
    reason: 'risky-files',
    files: risky.map((r) => r.file),
    categories: [...new Set([...risky.map((r) => r.category), ...contentFlags])],
    note: `[Security] ${task.id}: ตรวจเพราะแตะ ${listed}${more}${content}`,
  };
}

/** เรียก worker ตามนโยบาย session: resume ในรอบแก้ได้ติดกัน MAX_WORKER_RESUMES ครั้ง resume ล้ม = เปิดใหม่
 * รอบก่อนหน้าชนขีดจำกัด SDK (lastRoundLimit) ห้าม resume เสมอ (กัน M6: worker resume มาเจอ synthetic limit report เป็น previousReport) */
async function runWorker(
  deps: Deps,
  ctx: BuildContext,
  task: Task,
  progress: TaskProgress,
  round: number,
): Promise<WorkerResult> {
  const log = deps.log ?? nullLogger;
  const base = { task, ...ctx, previousReport: progress.lastReport };
  const resumes = progress.workerResumes ?? 0;
  const canResume =
    progress.lastReport !== undefined &&
    progress.workerSessionId !== undefined &&
    resumes < MAX_WORKER_RESUMES &&
    progress.lastRoundLimit !== true;
  if (canResume) {
    try {
      const out = await deps.runner.work({ ...base, resumeSessionId: progress.workerSessionId });
      progress.workerSessionId = out.sessionId;
      progress.workerResumes = resumes + 1;
      log.log('INFO', 'worker.session', { taskId: task.id, round, resumed: true, resumes: progress.workerResumes });
      return out.result;
    } catch (e) {
      if (isLimitError(e)) throw e;
      if (deps.abortSignal?.aborted) throw e;
      log.log('WARN', 'worker.resume_failed', { taskId: task.id, round, reason: errReason(e) });
    }
  }
  const out = await deps.runner.work(base);
  progress.workerSessionId = out.sessionId;
  progress.workerResumes = 0;
  log.log('INFO', 'worker.session', { taskId: task.id, round, resumed: false, resumes: 0 });
  return out.result;
}

async function runRound(
  deps: Deps,
  ctx: BuildContext,
  task: Task,
  progress: TaskProgress,
  state: State,
): Promise<{ report: QAReport; limitHit: boolean; securityReviewed: boolean }> {
  const { runner, io } = deps;
  let step: Step = 'work';
  let qaReport: QAReport | undefined;
  try {
    const round = progress.rounds + 1;
    // tree ก่อน worker แตะ task นี้ครั้งแรก ใช้หาไฟล์ทั้งหมดที่ task แตะตอนตัดสิน Security ของ quick/standard
    // (ตรวจแค่รอบแรกของ task เท่านั้น — ค่านี้อยู่ยาวตลอดอายุ task ไม่ถูกเลื่อนเหมือน reviewedTree)
    if (progress.rounds === 0 && progress.startTree === undefined) {
      progress.startTree = await trySnapshot(deps, task, round);
    }
    const result = await runWorker(deps, ctx, task, progress, round);
    step = 'qa';
    // baseline คือ tree ล่าสุดที่ QA ตรวจจริง (reviewedTree) ไม่ใช่ snapshot ตอนเริ่มรอบนี้ — กัน edit ที่ QA
    // ไม่เคยเห็นหลุดออกจาก diff (worker ชน limit หลังแก้บางส่วน, QA ชน limit, process ถูกฆ่ากลางคัน,
    // user แก้เองระหว่าง escalate prompt) รอบก่อนชนขีดจำกัด (lastRoundLimit) บังคับตรวจทั้ง task เสมอ
    const after = await trySnapshot(deps, task, round);
    const useDiff =
      progress.lastReport !== undefined &&
      progress.lastRoundLimit !== true &&
      progress.reviewedTree !== undefined &&
      after !== undefined;
    const roundDiff = useDiff ? await tryDiff(deps, task, round, progress.reviewedTree!, after!) : undefined;
    (deps.log ?? nullLogger).log(
      'INFO',
      'qa.scope',
      roundDiff
        ? {
            taskId: task.id,
            round,
            mode: 'diff',
            files: roundDiff.files.length,
            chars: roundDiff.diff.length,
            truncated: roundDiff.truncated,
          }
        : { taskId: task.id, round, mode: 'full' },
    );
    qaReport = await runner.qa(
      roundDiff ? { task, result, ...ctx, roundDiff, previousReport: progress.lastReport } : { task, result, ...ctx },
    );
    // QA ให้ผลจริงแล้ว (ไม่ใช่ limit ซึ่งโยน error ก่อนถึงบรรทัดนี้) — เลื่อน baseline มาเป็น tree รอบนี้
    updateReviewedTree(progress, after);
    if (!isPass(qaReport)) return { report: qaReport, limitHit: false, securityReviewed: false };

    // full (หรือไม่มี level) ตรวจทุก task เหมือนเดิม; quick/standard ตรวจเฉพาะ task ที่แตะไฟล์เสี่ยง/เนื้อหาเสี่ยง
    const security = await decideSecurity(deps, state, task, progress, round, result, after);
    (deps.log ?? nullLogger).log('INFO', 'security.trigger', {
      taskId: task.id,
      round,
      reason: security.reason,
      files: security.files,
      categories: security.categories,
    });
    if (!security.run) return { report: qaReport, limitHit: false, securityReviewed: false };
    if (security.note) io.say(security.note);

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
      if (step === 'work') {
        // session ที่ชนขีดจำกัดแล้ว resume ต่อก็มักชนอีก: รอบถัดไปเปิดใหม่
        delete progress.workerSessionId;
        delete progress.workerResumes;
      }
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
  const quick = state.level === 'quick';

  for (const task of orderTasks(design.tasks)) {
    const progress = state.progress[task.id];
    if (!progress) throw new Error(`ไม่พบ progress ของ task ${task.id}`);
    if (progress.done) continue;
    const outcome = await buildTask(deps, state, ctx, task, progress, quick);
    if (outcome === 'aborted') {
      state.phase = 'ABORTED';
      await deps.store.save(state);
      return;
    }
    if (outcome === 'escalated') {
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
  quick: boolean,
): Promise<Outcome> {
  const { io, store, config } = deps;
  for (;;) {
    while (progress.rounds < progress.maxRounds) {
      io.say(
        `[${task.owner}] ทำ task ${task.id}: ${task.title} (รอบที่ ${progress.rounds + 1}/${progress.maxRounds})`,
      );
      const { report, limitHit, securityReviewed } = await runRound(deps, ctx, task, progress, state);
      progress.rounds += 1;
      progress.lastReport = report;
      progress.securityReviewed = securityReviewed;
      progress.lastRoundLimit = limitHit;
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

    const decision = await escalate(deps, state, task, progress, quick);
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
    if (decision === 'standard' || decision === 'full') {
      // ยกระดับ quick -> standard/full: คืน design/progress เดิม (ถ้ามี), ตั้ง designFeedback ให้ Planning และ log ระดับที่ตัดสิน
      // ดู src/level.ts: escalateLevel
      escalateLevel(deps, state, task, progress, decision);
      return 'escalated';
    }
    progress.maxRounds += quick ? config.quickMaxQaRounds : config.extraRoundsOnContinue;
    await store.save(state);
  }
}

async function escalate(
  deps: Deps,
  state: State,
  task: Task,
  progress: TaskProgress,
  quick: boolean,
): Promise<Decision> {
  const { runner, io, config } = deps;
  const { turn, sessionId } = await runner.pmTurn({
    sessionId: state.pmSessionId,
    prompt:
      `task ${task.id} (${task.title}) ไม่ผ่าน QA ครบ ${progress.rounds} รอบแล้ว ` +
      `ปัญหาที่ค้าง:\n${JSON.stringify(progress.lastReport?.issues ?? [])}\n` +
      (quick
        ? 'สรุปให้ user ฟังเป็นภาษาไทยว่าค้างอะไร และอธิบายตัวเลือก: continue / accept / abort / standard ' +
          '(ยกระดับเป็น standard: Planning ออกแบบใหม่ ไม่ตรวจ Security design) / full (ยกระดับเป็นแบบเต็ม: Planning ออกแบบใหม่ + ตรวจ Security)'
        : 'สรุปให้ user ฟังเป็นภาษาไทยว่าค้างอะไร และอธิบายตัวเลือก: continue / accept / abort'),
  });
  state.pmSessionId = sessionId;
  await deps.store.save(state);
  io.say(`\n[PM] ${turn.message}\n`);
  const extraRounds = quick ? config.quickMaxQaRounds : config.extraRoundsOnContinue;
  const question =
    `task ${task.id} ไม่ผ่านครบ ${progress.rounds} รอบ (continue = ทำต่ออีก ${extraRounds} รอบ, accept = รับตามสภาพ, abort = ยกเลิก` +
    (quick
      ? ', standard = ยกระดับเป็น standard (แนะนำ: Planning ออกแบบใหม่ ไม่ตรวจ Security design), full = ยกระดับเป็นแบบเต็ม)'
      : ')');
  const options: readonly Decision[] = quick
    ? ['continue', 'accept', 'abort', 'standard', 'full']
    : ['continue', 'accept', 'abort'];
  return decide(deps, state, question, options);
}
