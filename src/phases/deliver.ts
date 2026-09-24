import type { Deps } from '../deps';
import { askNonEmpty, decide } from '../io-util';
import type { State } from '../state';

export async function runDeliver(deps: Deps, state: State): Promise<void> {
  const { runner, io, store } = deps;
  const { design } = state;
  if (!design) throw new Error('DELIVER ต้องมี design');

  const summary = design.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    owner: t.owner,
    acceptedWithIssues: state.progress[t.id]?.acceptedWithIssues ?? false,
    securityReviewed: state.progress[t.id]?.securityReviewed ?? false,
  }));
  const { turn, sessionId } = await runner.pmTurn({
    sessionId: state.pmSessionId,
    prompt:
      "งานทั้งหมดจบรอบ BUILD แล้ว (บาง task อาจถูก 'รับตามสภาพ' หรือรอบสุดท้ายยังไม่ผ่านการตรวจความปลอดภัย) " +
      'ช่วยสรุปส่งมอบให้ user ตรวจรับเป็นภาษาไทย ' +
      "task ที่ acceptedWithIssues=true คือ 'รับตามสภาพ' และ task ที่ securityReviewed=false คือรอบสุดท้ายที่ส่งมอบยังไม่ผ่านการตรวจความปลอดภัย (อาจเคยถูกตรวจในรอบก่อนหน้าแล้วพบปัญหาก็ได้) ให้ระบุทั้งสองเรื่องแยกกันให้ชัด:\n" +
      JSON.stringify(summary),
  });
  state.pmSessionId = sessionId;
  await store.save(state);
  io.say(`\n[PM] ${turn.message}\n`);

  const decision = await decide(deps, state, 'ตรวจรับงานนี้ไหม?', ['accept', 'change'] as const);
  if (decision === 'accept') {
    state.phase = 'DONE';
  } else {
    state.pendingPrompt = await askNonEmpty(io, 'อยากแก้หรือเพิ่มอะไร?\n> ');
    state.phase = 'REQUIREMENTS';
  }
  await store.save(state);
}
