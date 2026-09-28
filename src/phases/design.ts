import { askNonEmpty, decide } from '../io-util';
import type { Deps } from '../deps';
import { DesignError, initProgress, orderTasks } from '../domain';
import { formatDesign } from '../format';
import { logLevelDecided } from '../level';
import { nullLogger } from '../logger';
import { designRiskText, mergeRiskFlags, riskFlags, riskText } from '../risk';
import type { Design, Requirements } from '../schemas';
import type { State } from '../state';

/**
 * เรียก Security ตรวจ design (ตรวจไม่สำเร็จ = คืน undefined + เตือน user) — ใช้ทั้งตอน runDesign (ระดับ full/quick)
 * และตอน runReview (ระดับ standard ที่ user เลือกยกเป็น full)
 */
async function reviewDesignSecurity(
  deps: Deps,
  design: Design,
  requirements: Requirements,
): Promise<string[] | undefined> {
  try {
    return await deps.runner.securityDesign({ design, requirements });
  } catch (e) {
    (deps.log ?? nullLogger).log('WARN', 'security.design_failed', { reason: String(e) });
    deps.io.say(`[Security] ตรวจ design ไม่สำเร็จ (${String(e)}) — ยังไม่มีผลตรวจความปลอดภัยของ design นี้`);
    return undefined;
  }
}

export async function runDesign(deps: Deps, state: State): Promise<void> {
  const { runner, store } = deps;
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
    if (state.level === 'standard') {
      // standard ไม่มี Security ตรวจ design (Security ตรวจเฉพาะ task ที่แตะไฟล์เสี่ยงตอน BUILD หรือ user เลือกยกเป็น full ตอน REVIEW)
      state.design = { ...design };
      delete state.design.securityNotes;
    } else {
      const securityNotes = await reviewDesignSecurity(deps, design, state.requirements);
      state.design = { ...design, securityNotes };
    }
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
  const requirements = state.requirements!;

  const { turn, sessionId } = await runner.pmTurn({
    sessionId: state.pmSessionId,
    prompt: `Planning ส่ง design กลับมาแล้ว ช่วยสรุปให้ user ฟังเป็นภาษาไทย เน้นสิ่งที่ user ควรตรวจสอบ\n\n${JSON.stringify(design)}`,
  });
  state.pmSessionId = sessionId;
  await store.save(state);
  io.say(`\n[PM] ${turn.message}\n`);
  io.say(formatDesign(design, { level: state.level }));

  let options: readonly ('full' | 'confirm' | 'revise')[] = ['confirm', 'revise'];
  const flags =
    state.level === 'standard' && requirements
      ? mergeRiskFlags(riskFlags(riskText(requirements)), riskFlags(designRiskText(design)))
      : [];
  if (flags.length) {
    io.say(`⚠ requirements/design แตะเรื่อง ${flags.join(', ')} — แนะนำ full (Security ตรวจ design และทุก task)`);
    options = ['full', 'confirm', 'revise'];
  }
  let decision = await decide(deps, state, 'ยืนยันแบบนี้ไหม?', options);
  if (decision === 'full') {
    const securityNotes = await reviewDesignSecurity(deps, design, requirements);
    state.level = 'full';
    state.design = { ...design, securityNotes };
    await store.saveArtifact('design.json', state.design);
    logLevelDecided(deps, 'full', 'user', 'standard เจอคำเสี่ยงตอน REVIEW', flags);
    await store.save(state);
    io.say(formatDesign(state.design, { level: 'full' }));
    decision = await decide(deps, state, 'ยืนยันแบบนี้ไหม?', ['confirm', 'revise'] as const);
  }
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
