import { askNonEmpty, decide } from '../io-util';
import type { Deps } from '../deps';
import { DesignError, initProgress, orderTasks } from '../domain';
import { formatDesign } from '../format';
import { nullLogger } from '../logger';
import type { State } from '../state';

export async function runDesign(deps: Deps, state: State): Promise<void> {
  const { runner, store, io } = deps;
  if (!state.requirements) throw new Error('DESIGN ต้องมี requirements');

  let designError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const feedback = [state.designFeedback, designError].filter(Boolean).join('\n\n') || undefined;
    const design = await runner.plan({
      requirements: state.requirements,
      previousDesign: state.design,
      feedback,
    });
    try {
      orderTasks(design.tasks);
    } catch (e) {
      if (!(e instanceof DesignError)) throw e;
      designError = `design ที่ส่งมาไม่ถูกต้อง: ${e.message} — แก้ให้ถูกแล้วส่งใหม่`;
      continue;
    }
    let securityNotes: string[] | undefined;
    try {
      securityNotes = await runner.securityDesign({ design, requirements: state.requirements });
    } catch (e) {
      (deps.log ?? nullLogger).log('WARN', 'security.design_failed', { reason: String(e) });
      io.say(`[Security] ตรวจ design ไม่สำเร็จ (${String(e)}) — ยังไม่มีผลตรวจความปลอดภัยของ design นี้`);
    }
    state.design = { ...design, securityNotes };
    delete state.designFeedback;
    state.phase = 'REVIEW';
    await store.saveArtifact('design.json', state.design);
    await store.save(state);
    return;
  }
  throw new DesignError('Planning ส่ง design ที่ไม่ถูกต้องซ้ำ 2 ครั้ง');
}

export async function runReview(deps: Deps, state: State): Promise<void> {
  const { runner, io, store, config } = deps;
  const { design } = state;
  if (!design) throw new Error('REVIEW ต้องมี design');

  const { turn, sessionId } = await runner.pmTurn({
    sessionId: state.pmSessionId,
    prompt: `Planning ส่ง design กลับมาแล้ว ช่วยสรุปให้ user ฟังเป็นภาษาไทย เน้นสิ่งที่ user ควรตรวจสอบ\n\n${JSON.stringify(design)}`,
  });
  state.pmSessionId = sessionId;
  await store.save(state);
  io.say(`\n[PM] ${turn.message}\n`);
  io.say(formatDesign(design));

  const decision = await decide(deps, state, 'ยืนยันแบบนี้ไหม?', ['confirm', 'revise'] as const);
  if (decision === 'confirm') {
    state.progress = initProgress(design, state.progress, config.maxQaRounds);
    state.phase = 'BUILD';
  } else {
    const revision = await askNonEmpty(io, 'อยากแก้อะไรในแบบ?\n> ');
    state.pendingPrompt = revision;
    state.designFeedback = revision;
    state.phase = 'REQUIREMENTS';
  }
  await store.save(state);
}
