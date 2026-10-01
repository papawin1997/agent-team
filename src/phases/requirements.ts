import type { Deps, LevelHintState } from '../deps';
import { formatRequirements } from '../format';
import { askNonEmpty } from '../io-util';
import { confirmAsFull, decideLevel, offersChoice } from '../level';
import { mergeRiskFlags, riskFlags, type RiskCategory } from '../risk';
import type { Level } from '../schemas';
import type { State } from '../state';

const LEVEL_HINT: Record<Level, string> = {
  quick: '[ผู้ใช้ขอโหมด quick ถ้างานเข้าเกณฑ์]',
  standard: '[ผู้ใช้ขอโหมด standard: ไม่ใช้ quick]',
  full: '[ผู้ใช้สั่ง --full: ต้องเป็น full เท่านั้น]',
};

export async function runRequirements(
  deps: Deps,
  state: State,
  levelHint: LevelHintState = { sent: false },
): Promise<void> {
  const { io, runner, store } = deps;

  // ความเสี่ยงจากข้อความที่ user พิมพ์เอง (ไม่ใช่แค่ requirements/quickTask ที่ PM สรุป) สะสมตลอด loop นี้
  // เพื่อกันงานเสี่ยงที่ PM สรุปออกมาดูไม่เสี่ยง (เช่น requirements ยังไม่ครบ) แต่ user พิมพ์คำเสี่ยงไว้ตรง ๆ
  let userRisk: readonly RiskCategory[] = [];
  const noteUserText = (text: string): void => {
    userRisk = mergeRiskFlags(userRisk, riskFlags(text));
  };

  const opening = state.pmSessionId
    ? 'พิมพ์ข้อความถึง PM เพื่อคุยต่อ\n> '
    : 'คุณอยากได้ระบบอะไร? เล่า requirement ให้ PM ฟังได้เลย\n> ';
  const rawPrompt = state.pendingPrompt ?? (await askNonEmpty(io, opening));
  noteUserText(rawPrompt);
  let prompt = rawPrompt;
  if (!state.title && !state.pmSessionId) {
    // save ก่อนเรียก PM: ถ้า Ctrl+C ระหว่าง PM ตอบ งานก็ยังมีชื่อ ไม่กลายเป็นงานเปล่า
    state.title = Array.from(prompt).slice(0, 60).join('');
    await store.save(state);
  }
  if (state.requirements) {
    prompt = `requirements ปัจจุบัน:\n${JSON.stringify(state.requirements)}\n\nคำขอแก้ไขจาก user: ${prompt}`;
  }
  // บอก PM เรื่อง --quick/--full ในข้อความแรกที่คุยกับ PM ของการรันนี้เสมอ (ไม่ว่าจะเป็นงานใหม่หรืองานค้างที่คุยกับ PM มาก่อนแล้ว)
  if (deps.levelPreference && !levelHint.sent) {
    prompt = `${LEVEL_HINT[deps.levelPreference]}\n${prompt}`;
    levelHint.sent = true;
  }
  state.pendingPrompt = undefined;

  for (;;) {
    let response;
    try {
      response = await runner.pmTurn({ prompt, sessionId: state.pmSessionId });
    } catch (e) {
      // PM ล้ม (เช่นส่ง JSON ไม่ผ่านซ้ำ) ไม่ควรทำให้ทั้ง run หยุด: ให้ user ส่งข้อความเดิมซ้ำหรือพิมพ์ใหม่
      io.say(
        `\n[PM] PM ตอบไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — ` +
          'กด Enter เพื่อส่งข้อความเดิมอีกครั้ง หรือพิมพ์ข้อความใหม่\n',
        'error',
      );
      const retry = (await io.ask('> ')).trim();
      if (retry !== '') {
        noteUserText(retry);
        prompt = retry;
      }
      continue;
    }
    const { turn } = response;
    state.pmSessionId = response.sessionId;
    await store.save(state);
    io.say(turn.message, 'pm');

    if (turn.status === 'proposal' && turn.requirements) {
      io.say(formatRequirements(turn.requirements));
      if (offersChoice(deps, turn)) {
        if (await decideLevel(deps, state, turn, userRisk)) return;
        const revise = await askNonEmpty(io, 'อยากปรับอะไร?\n> ');
        noteUserText(revise);
        prompt = revise;
        continue;
      }
      if (await confirmAsFull(deps, state, turn)) return;
      const revise = await askNonEmpty(io, 'อยากปรับอะไร?\n> ');
      noteUserText(revise);
      prompt = revise;
      continue;
    }
    const next = await askNonEmpty(io, '> ');
    noteUserText(next);
    prompt = next;
  }
}
