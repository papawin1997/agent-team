import type { Deps } from '../deps';
import { isPass, orderTasks } from '../domain';
import type { Design, Requirements, Task } from '../schemas';
import type { State, TaskProgress } from '../state';

type Outcome = 'done' | 'aborted';
type Decision = 'continue' | 'accept' | 'abort';
interface BuildContext {
  design: Design;
  requirements: Requirements;
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
  const { runner, io, store, config } = deps;
  for (;;) {
    while (progress.rounds < progress.maxRounds) {
      io.say(
        `[${task.owner}] ทำ task ${task.id}: ${task.title} (รอบที่ ${progress.rounds + 1}/${progress.maxRounds})`,
      );
      const result = await runner.work({ task, ...ctx, previousReport: progress.lastReport });
      const report = await runner.qa({ task, result, ...ctx });
      progress.rounds += 1;
      progress.lastReport = report;
      await store.saveArtifact(`reports/${task.id}-round${progress.rounds}.json`, report);

      const passed = isPass(report);
      io.say(`[QA] ${task.id}: ${passed ? 'PASS' : 'FAIL'} (${report.issues.length} issues)`);
      if (passed) {
        progress.done = true;
        await store.save(state);
        return 'done';
      }
      await store.save(state);
    }

    const decision = await escalate(deps, state, task, progress);
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
