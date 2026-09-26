import type { Deps, UserIO } from './deps';
import type { PmTurn } from './schemas';
import type { State } from './state';

export async function askNonEmpty(io: UserIO, prompt: string): Promise<string> {
  for (;;) {
    const answer = (await io.ask(prompt)).trim();
    if (answer !== '') return answer;
    io.say('กรุณาพิมพ์ข้อความ (ห้ามเว้นว่าง)');
  }
}

export async function confirmYesNo(io: UserIO, question: string): Promise<boolean> {
  for (;;) {
    const answer = (await io.ask(question)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    io.say('กรุณาตอบ y หรือ n');
  }
}

export async function decide<T extends string>(
  deps: Deps,
  state: State,
  prompt: string,
  options: readonly T[],
  onTurn?: (turn: PmTurn) => void,
): Promise<T> {
  const { runner, io, store } = deps;
  for (;;) {
    const result = await io.chooseOrText(prompt, options);
    if (typeof result === 'string') return result;
    if (result.text.trim() === '') continue;
    const context = `[ระหว่างรอการตัดสินใจ: "${prompt}" ตัวเลือกที่มี: ${options.join(', ')}]\n\n${result.text}`;
    let turn: PmTurn;
    try {
      const response = await runner.pmTurn({ sessionId: state.pmSessionId, prompt: context });
      turn = response.turn;
      state.pmSessionId = response.sessionId;
    } catch (e) {
      io.say(`\n[PM] ถาม PM ไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — ลองถามใหม่หรือเลือกตัวเลือกได้เลย\n`);
      continue;
    }
    io.say(`\n[PM] ${turn.message}\n`);
    onTurn?.(turn);
    try {
      await store.save(state);
    } catch (e) {
      io.say(`\n[PM] บันทึกสถานะไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — คำตอบข้างบนยังใช้ได้ แต่อาจไม่ถูกบันทึกลงดิสก์\n`);
    }
  }
}
