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
    securityTrigger: state.progress[t.id]?.securityTrigger ?? 'none',
  }));
  // I3: quick/standard เรียก Security เฉพาะ task ที่แตะไฟล์เสี่ยง/เนื้อหาเสี่ยง (ไม่ใช่ทุก task เหมือน full)
  // ต้องบอก PM ตรง ๆ ว่า securityReviewed=false ที่ securityTrigger='none' คือถูกข้ามโดยตั้งใจ ไม่ใช่ช่องว่างที่หลุดไป
  const levelNote =
    state.level === 'quick'
      ? 'งานนี้ทำแบบโหมด quick: ไม่มีขั้นออกแบบ '
      : state.level === 'standard'
        ? 'งานนี้ทำแบบโหมด standard: ไม่มีการตรวจ Security ตอนออกแบบ '
        : '';
  const quickNote =
    state.level === 'quick' || state.level === 'standard'
      ? `${levelNote}และ Security ตรวจเฉพาะ task ที่แตะไฟล์เสี่ยงหรือเนื้อหาเสี่ยงเท่านั้น (ดู securityTrigger ของแต่ละ task) ให้บอก user สั้น ๆ `
      : '';
  const { turn, sessionId } = await runner.pmTurn({
    sessionId: state.pmSessionId,
    prompt:
      quickNote +
      "งานทั้งหมดจบรอบ BUILD แล้ว (บาง task อาจถูก 'รับตามสภาพ' หรือรอบสุดท้ายยังไม่ผ่านการตรวจความปลอดภัย) " +
      'ช่วยสรุปส่งมอบให้ user ตรวจรับเป็นภาษาไทย ' +
      "task ที่ acceptedWithIssues=true คือ 'รับตามสภาพ' " +
      "securityTrigger ของแต่ละ task คือเหตุผลที่ Security ถูกเรียก (หรือไม่ถูกเรียก): 'level' = ตรวจเพราะเป็นงาน full, " +
      "'risky-files' = ตรวจเพราะแตะไฟล์หรือเนื้อหาเสี่ยง (โหมด quick/standard), 'none' = ไม่ตรวจเพราะไม่แตะอะไรเสี่ยงเลยโดยตั้งใจ ไม่ใช่ช่องว่างที่หลุดไป " +
      "task ที่ securityReviewed=false และ securityTrigger='none' ไม่ต้องแจ้งว่าเป็นปัญหา (ถูกออกแบบให้ข้ามการตรวจ) " +
      "ส่วน task ที่ securityReviewed=false แต่ securityTrigger ไม่ใช่ 'none' คือรอบสุดท้ายที่ส่งมอบยังไม่ผ่านการตรวจความปลอดภัยจริง (อาจเคยถูกตรวจในรอบก่อนหน้าแล้วพบปัญหาก็ได้) ให้ระบุเรื่องนี้กับ acceptedWithIssues แยกกันให้ชัด:\n" +
      JSON.stringify(summary),
  });
  state.pmSessionId = sessionId;
  await store.save(state);
  io.say(turn.message, 'pm');

  const decision = await decide(deps, state, 'ตรวจรับงานนี้ไหม?', ['accept', 'change'] as const);
  if (decision === 'accept') {
    state.phase = 'DONE';
  } else {
    state.pendingPrompt = await askNonEmpty(io, 'อยากแก้หรือเพิ่มอะไร?\n> ');
    state.phase = 'REQUIREMENTS';
  }
  await store.save(state);
}
