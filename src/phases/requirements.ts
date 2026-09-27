import type { Deps } from '../deps';
import { initProgress, quickDesign } from '../domain';
import { formatQuickTask, formatRequirements } from '../format';
import { askNonEmpty, decide } from '../io-util';
import { nullLogger } from '../logger';
import { riskFlags, riskText, type RiskCategory } from '../risk';
import type { Level, PmTurn } from '../schemas';
import type { State } from '../state';

const LEVEL_HINT: Record<Level, string> = {
  quick: '[ผู้ใช้ขอโหมด quick ถ้างานเข้าเกณฑ์]',
  full: '[ผู้ใช้สั่ง --full: ต้องเป็น full เท่านั้น]',
};

const LEVEL_PROMPT = 'ทำแบบไหน? (quick = ทำเลยแบบย่อ 1 task, full = ออกแบบก่อนแบบเต็ม, revise = แก้ requirements)';

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
  if (!state.pmSessionId && deps.levelPreference) prompt = `${LEVEL_HINT[deps.levelPreference]}\n${prompt}`;
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
      );
      const retry = (await io.ask('> ')).trim();
      if (retry !== '') prompt = retry;
      continue;
    }
    let { turn } = response;
    state.pmSessionId = response.sessionId;
    await store.save(state);
    io.say(`\n[PM] ${turn.message}\n`);

    if (turn.status === 'proposal' && turn.requirements) {
      io.say(formatRequirements(turn.requirements));
      if (offersQuick(deps, turn)) {
        if (await decideLevel(deps, state, turn)) return;
        prompt = await askNonEmpty(io, 'อยากปรับอะไร?\n> ');
        continue;
      }
      const decision = await decide(deps, state, 'ยืนยัน requirements นี้ไหม?', ['confirm', 'revise'] as const, (newTurn) => {
        if (newTurn.status === 'proposal' && newTurn.requirements) {
          turn = newTurn;
          io.say(formatRequirements(newTurn.requirements));
        }
      });
      if (decision === 'confirm') {
        state.requirements = turn.requirements!;
        state.level = 'full';
        state.quickTask = undefined;
        state.phase = 'DESIGN';
        await store.saveArtifact('requirements.json', turn.requirements!);
        logLevel(deps, 'full', deps.levelPreference === 'full' ? 'user' : 'pm', turn.levelReason, []);
        await store.save(state);
        return;
      }
      prompt = await askNonEmpty(io, 'อยากปรับอะไร?\n> ');
      continue;
    }
    prompt = await askNonEmpty(io, '> ');
  }
}

function offersQuick(deps: Deps, turn: PmTurn): boolean {
  return deps.levelPreference !== 'full' && turn.level === 'quick' && turn.quickTask !== undefined;
}

function logLevel(deps: Deps, level: Level, by: 'pm' | 'user', reason: string | undefined, flags: RiskCategory[]): void {
  (deps.log ?? nullLogger).log('INFO', 'level.decided', { level, by, reason, riskFlags: flags });
}

/** PM เสนอ quick: ให้ user เลือก quick/full/revise — true = ตัดสินแล้ว (ไป BUILD หรือ DESIGN), false = revise */
async function decideLevel(deps: Deps, state: State, first: PmTurn): Promise<boolean> {
  const { io, store, config } = deps;
  let turn = first;
  const show = (t: PmTurn): void => {
    if (t.quickTask) io.say(formatQuickTask(t.quickTask));
    if (t.levelReason) io.say(`ระดับที่ PM เสนอ: ${t.level ?? 'full'} — ${t.levelReason}`);
  };
  show(turn);
  const flags = riskFlags(riskText(turn.requirements!, turn.quickTask));
  if (flags.length) io.say(`⚠ งานนี้แตะเรื่อง ${flags.join(', ')} — แนะนำ full (มีขั้นออกแบบและตรวจ Security)`);
  const options: readonly ('quick' | 'full' | 'revise')[] = flags.length
    ? ['full', 'quick', 'revise']
    : ['quick', 'full', 'revise'];

  const decision = await decide(deps, state, LEVEL_PROMPT, options, (newTurn) => {
    if (newTurn.status === 'proposal' && newTurn.requirements) {
      turn = newTurn;
      io.say(formatRequirements(newTurn.requirements));
      show(newTurn);
    }
  });
  if (decision === 'revise') return false;

  const requirements = turn.requirements!;
  state.requirements = requirements;
  await store.saveArtifact('requirements.json', requirements);
  if (decision === 'quick' && turn.quickTask) {
    const design = quickDesign(requirements, turn.quickTask);
    state.level = 'quick';
    state.quickTask = turn.quickTask;
    state.design = design;
    state.progress = initProgress(design, state.progress, config.quickMaxQaRounds);
    state.phase = 'BUILD';
    await store.saveArtifact('design.json', design);
  } else {
    state.level = 'full';
    state.quickTask = undefined;
    state.phase = 'DESIGN';
  }
  logLevel(deps, state.level, turn.level === state.level ? 'pm' : 'user', turn.levelReason, flags);
  await store.save(state);
  return true;
}
