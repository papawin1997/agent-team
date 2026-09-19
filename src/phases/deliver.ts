import type { Deps } from '../deps';
import { askNonEmpty } from '../io-util';
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
  }));
  const { turn, sessionId } = await runner.pmTurn({
    sessionId: state.pmSessionId,
    prompt:
      "งานทั้งหมดผ่าน QA แล้ว ช่วยสรุปส่งมอบให้ user ตรวจรับเป็นภาษาไทย " +
      "task ที่ acceptedWithIssues=true คือ 'รับตามสภาพ' ให้ระบุให้ชัด:\n" +
      JSON.stringify(summary),
  });
  state.pmSessionId = sessionId;
  await store.save(state);
  io.say(`\n[PM] ${turn.message}\n`);

  const decision = await io.choose('ตรวจรับงานนี้ไหม?', ['accept', 'change'] as const);
  if (decision === 'accept') {
    state.phase = 'DONE';
  } else {
    state.pendingPrompt = await askNonEmpty(io, 'อยากแก้หรือเพิ่มอะไร?\n> ');
    state.phase = 'REQUIREMENTS';
  }
  await store.save(state);
}
