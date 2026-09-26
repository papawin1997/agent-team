import type { Deps } from '../deps';
import { askNonEmpty, decide } from '../io-util';
import { formatRequirements } from '../format';
import type { State } from '../state';

export async function runRequirements(deps: Deps, state: State): Promise<void> {
  const { io, runner, store } = deps;

  const opening = state.pmSessionId
    ? 'พิมพ์ข้อความถึง PM เพื่อคุยต่อ\n> '
    : 'คุณอยากได้ระบบอะไร? เล่า requirement ให้ PM ฟังได้เลย\n> ';
  let prompt = state.pendingPrompt ?? (await askNonEmpty(io, opening));
  if (!state.title && !state.pmSessionId) {
    // save ก่อนเรียก PM: ถ้า Ctrl+C ระหว่าง PM ตอบ งานก็ยังมีชื่อ ไม่กลายเป็นงานเปล่า
    state.title = Array.from(prompt).slice(0, 60).join('');
    await store.save(state);
  }
  if (state.requirements) {
    prompt = `requirements ปัจจุบัน:\n${JSON.stringify(state.requirements)}\n\nคำขอแก้ไขจาก user: ${prompt}`;
  }
  state.pendingPrompt = undefined;

  for (;;) {
    let { turn, sessionId } = await runner.pmTurn({ prompt, sessionId: state.pmSessionId });
    state.pmSessionId = sessionId;
    await store.save(state);
    io.say(`\n[PM] ${turn.message}\n`);

    if (turn.status === 'proposal' && turn.requirements) {
      io.say(formatRequirements(turn.requirements));
      const decision = await decide(deps, state, 'ยืนยัน requirements นี้ไหม?', ['confirm', 'revise'] as const, (newTurn) => {
        if (newTurn.status === 'proposal' && newTurn.requirements) {
          turn = newTurn;
          io.say(formatRequirements(newTurn.requirements));
        }
      });
      if (decision === 'confirm') {
        state.requirements = turn.requirements!;
        state.phase = 'DESIGN';
        await store.saveArtifact('requirements.json', turn.requirements!);
        await store.save(state);
        return;
      }
      prompt = await askNonEmpty(io, 'อยากปรับอะไร?\n> ');
      continue;
    }
    prompt = await askNonEmpty(io, '> ');
  }
}
