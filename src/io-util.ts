import type { Deps, UserIO } from './deps';
import type { State } from './state';

export async function askNonEmpty(io: UserIO, prompt: string): Promise<string> {
  for (;;) {
    const answer = (await io.ask(prompt)).trim();
    if (answer !== '') return answer;
    io.say('กรุณาพิมพ์ข้อความ (ห้ามเว้นว่าง)');
  }
}

export async function decide<T extends string>(
  deps: Deps,
  state: State,
  prompt: string,
  options: readonly T[],
): Promise<T> {
  const { runner, io, store } = deps;
  for (;;) {
    const result = await io.chooseOrText(prompt, options);
    if (typeof result === 'string') return result;
    if (result.text.trim() === '') continue;
    io.say('[PM] กำลังตอบคำถาม...');
    try {
      const { turn, sessionId } = await runner.pmTurn({ sessionId: state.pmSessionId, prompt: result.text });
      state.pmSessionId = sessionId;
      await store.save(state);
      io.say(`\n[PM] ${turn.message}\n`);
    } catch (e) {
      io.say(`\n[PM] ถาม PM ไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — ลองถามใหม่หรือเลือกตัวเลือกได้เลย\n`);
    }
  }
}
