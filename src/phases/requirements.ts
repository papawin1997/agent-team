import type { Deps } from '../deps';
import { initProgress, quickDesign, restoreBaseDesign, QUICK_TASK_ID } from '../domain';
import { formatQuickTask, formatRequirements } from '../format';
import { askNonEmpty, decide } from '../io-util';
import { logLevelDecided } from '../level';
import { mergeRiskFlags, riskFlags, riskText, type RiskCategory } from '../risk';
import type { Level, PmTurn } from '../schemas';
import type { State } from '../state';

const LEVEL_HINT: Record<Level, string> = {
  quick: '[ผู้ใช้ขอโหมด quick ถ้างานเข้าเกณฑ์]',
  full: '[ผู้ใช้สั่ง --full: ต้องเป็น full เท่านั้น]',
};

const LEVEL_PROMPT = 'ทำแบบไหน? (quick = ทำเลยแบบย่อ 1 task, full = ออกแบบก่อนแบบเต็ม, revise = แก้ requirements)';

export async function runRequirements(deps: Deps, state: State): Promise<void> {
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
  if (deps.levelPreference && !deps.levelHintSent) {
    prompt = `${LEVEL_HINT[deps.levelPreference]}\n${prompt}`;
    deps.levelHintSent = true;
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
    io.say(`\n[PM] ${turn.message}\n`);

    if (turn.status === 'proposal' && turn.requirements) {
      io.say(formatRequirements(turn.requirements));
      if (offersQuick(deps, turn)) {
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

function offersQuick(deps: Deps, turn: PmTurn): boolean {
  return deps.levelPreference !== 'full' && turn.level === 'quick' && turn.quickTask !== undefined;
}

/**
 * ล้าง design สังเคราะห์ของโหมด quick (ถ้ามี) ก่อนตัดสินว่างานนี้เป็น full
 * เพื่อให้ Planning เริ่มออกแบบใหม่จริง ๆ ไม่เห็น design 1 task ของโหมด quick เป็น previousDesign
 * แต่ถ้าเคยเก็บ design จริงของงาน full เดิมไว้ใน baseDesign (ก่อนถูก triage เป็น quick) ให้คืนค่านั้นกลับมาแทน
 * ที่จะล้างทิ้งเฉย ๆ — Planning จะได้เห็นเป็น previousDesign และคง task id เดิมไว้ ไม่เสีย design เดิมที่ทำไปแล้ว
 */
function clearStaleQuickDesign(state: State): void {
  const hadQuickDesign =
    state.level === 'quick' ||
    (state.design !== undefined && state.design.tasks.length === 1 && state.design.tasks[0]?.id === QUICK_TASK_ID);
  if (hadQuickDesign) restoreBaseDesign(state);
}

/** ยอมรับ turn นี้เป็นงาน full: confirm = ไป DESIGN, revise = คุยต่อ (false ให้ผู้เรียกไปถาม "อยากปรับอะไร?") */
async function confirmAsFull(
  deps: Deps,
  state: State,
  turn: PmTurn,
  flags: readonly RiskCategory[] = [],
): Promise<boolean> {
  const { io } = deps;
  let current = turn;
  const decision = await decide(deps, state, 'ยืนยัน requirements นี้ไหม?', ['confirm', 'revise'] as const, (newTurn) => {
    if (newTurn.status === 'proposal' && newTurn.requirements) {
      current = newTurn;
      io.say(formatRequirements(newTurn.requirements));
    }
  });
  if (decision !== 'confirm') return false;
  await acceptFull(deps, state, current, flags);
  return true;
}

async function acceptFull(
  deps: Deps,
  state: State,
  turn: PmTurn,
  flags: readonly RiskCategory[] = [],
): Promise<void> {
  const { store, levelPreference } = deps;
  clearStaleQuickDesign(state);
  state.requirements = turn.requirements!;
  state.level = 'full';
  state.quickTask = undefined;
  state.phase = 'DESIGN';
  await store.saveArtifact('requirements.json', turn.requirements!);
  logLevelDecided(deps, 'full', levelPreference === 'full' ? 'user' : 'pm', turn.levelReason, flags);
  await store.save(state);
}

/** PM เสนอ quick: ให้ user เลือก quick/full/revise — true = ตัดสินแล้ว (ไป BUILD หรือ DESIGN), false = revise */
async function decideLevel(
  deps: Deps,
  state: State,
  first: PmTurn,
  userRisk: readonly RiskCategory[] = [],
): Promise<boolean> {
  const { io, store, config } = deps;
  let turn = first;
  const show = (t: PmTurn): void => {
    if (t.quickTask) io.say(formatQuickTask(t.quickTask));
    if (t.levelReason) io.say(`ระดับที่ PM เสนอ: ${t.level ?? 'full'} — ${t.levelReason}`);
  };
  const warn = (f: readonly RiskCategory[]): void => {
    if (f.length) io.say(`⚠ งานนี้แตะเรื่อง ${f.join(', ')} — แนะนำ full (มีขั้นออกแบบและตรวจ Security)`);
  };
  const computeFlags = (t: PmTurn): RiskCategory[] =>
    mergeRiskFlags(riskFlags(riskText(t.requirements!, t.quickTask)), userRisk);
  show(turn);
  let flags = computeFlags(turn);
  warn(flags);
  const options: readonly ('quick' | 'full' | 'revise')[] = flags.length
    ? ['full', 'quick', 'revise']
    : ['quick', 'full', 'revise'];

  // true เฉพาะเมื่อความเสี่ยงโผล่ขึ้นมาใหม่ระหว่างตัดสินใจ (onTurn ปรับ flags จากไม่เสี่ยง/หมวดอื่นเป็นเสี่ยง)
  // ไม่ใช่กรณีที่ turn แรกเสี่ยงอยู่แล้วตั้งแต่ต้น (ตัวเลือกถูกเรียง full ก่อนให้ user เห็นแต่แรกแล้ว ไม่ต้องถามซ้ำ)
  // ถ้า proposal รอบหลังกลับไม่เสี่ยงแล้ว (newFlags ว่าง) reset กลับเป็น false — ไม่ต้องถามซ้ำเพราะความเสี่ยงหายไปแล้วจริง ๆ
  let riskAppearedMidDecision = false;
  const onTurn = (newTurn: PmTurn): void => {
    if (newTurn.status !== 'proposal' || !newTurn.requirements) return;
    turn = newTurn;
    io.say(formatRequirements(newTurn.requirements));
    show(newTurn);
    const newFlags = computeFlags(newTurn);
    const changed = newFlags.length !== flags.length || newFlags.some((f, i) => f !== flags[i]);
    if (offersQuick(deps, newTurn) && changed) warn(newFlags);
    if (newFlags.length === 0) {
      riskAppearedMidDecision = false;
    } else if (changed) {
      riskAppearedMidDecision = true;
    }
    flags = newFlags;
  };

  let decision = await decide(deps, state, LEVEL_PROMPT, options, onTurn);
  if (decision === 'revise') return false;

  if (decision === 'quick' && offersQuick(deps, turn) && riskAppearedMidDecision) {
    // user เลือก quick จากตัวเลือกที่เห็นก่อนความเสี่ยงจะโผล่มา (options ยังไม่ได้เรียง full ก่อน): ห้ามรับทันที
    // เตือนอีกครั้งแล้วถามซ้ำด้วยตัวเลือกที่เรียง full ก่อน ยึดคำตอบรอบสองเป็นที่สุด (ไม่ถามวนซ้ำไม่รู้จบ)
    warn(flags);
    decision = await decide(deps, state, LEVEL_PROMPT, ['full', 'quick', 'revise'] as const, onTurn);
    if (decision === 'revise') return false;
  }

  if (decision === 'quick' && !offersQuick(deps, turn)) {
    // PM เปลี่ยนข้อเสนอระหว่างที่ user กำลังตัดสินใจ (ไม่เสนอ quick แล้ว): quick ที่เลือกไว้ใช้ไม่ได้กับ turn ล่าสุด
    // ห้ามยอมรับ quick แบบเงียบ ๆ — บอก user แล้วถามยืนยันแบบ full ตามปกติ
    io.say('PM เปลี่ยนข้อเสนอเป็น full แล้ว');
    return confirmAsFull(deps, state, turn, flags);
  }

  const requirements = turn.requirements!;
  state.requirements = requirements;
  await store.saveArtifact('requirements.json', requirements);
  if (decision === 'quick' && turn.quickTask) {
    // งานนี้เคยมี design จริง (ไม่ใช่ design สังเคราะห์ของ quick เอง) มาก่อน แล้วเพิ่งถูก triage เป็น quick รอบนี้:
    // เก็บ design/progress เดิมไว้ใน baseDesign/baseProgress ก่อนสร้าง design สังเคราะห์ทับ จะได้ไม่เสีย design เดิม
    // (ไม่เขียนทับ baseDesign ที่เก็บไว้แล้วจากรอบก่อน — ให้ full ดั้งเดิมสุดชนะเสมอ)
    const hadRealDesign =
      state.design !== undefined &&
      state.level !== 'quick' &&
      !(state.design.tasks.length === 1 && state.design.tasks[0]?.id === QUICK_TASK_ID);
    if (hadRealDesign && state.baseDesign === undefined) {
      state.baseDesign = state.design;
      state.baseProgress = state.progress;
    }
    const design = quickDesign(requirements, turn.quickTask, state.baseDesign);
    state.level = 'quick';
    state.quickTask = turn.quickTask;
    state.design = design;
    state.progress = initProgress(design, state.progress, config.quickMaxQaRounds);
    state.phase = 'BUILD';
    delete state.designFeedback;
    await store.saveArtifact('design.json', design);
  } else {
    clearStaleQuickDesign(state);
    state.level = 'full';
    state.quickTask = undefined;
    state.phase = 'DESIGN';
  }
  logLevelDecided(deps, state.level, turn.level === state.level ? 'pm' : 'user', turn.levelReason, flags);
  await store.save(state);
  return true;
}
