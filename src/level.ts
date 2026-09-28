import type { Deps } from './deps';
import { initProgress, quickDesign, QUICK_TASK_ID } from './domain';
import { formatQuickTask, formatRequirements } from './format';
import { decide } from './io-util';
import { nullLogger } from './logger';
import { mergeRiskFlags, riskFlags, riskText, type RiskCategory } from './risk';
import type { Level, PmTurn, Task } from './schemas';
import type { State, TaskProgress } from './state';

/**
 * โมดูลรวม logic ตัดสิน/เปลี่ยนระดับงาน (quick/full) ที่แต่เดิมกระจายอยู่ใน phases/requirements.ts และ
 * phases/build.ts (ดู nit สุดท้ายใน docs/check/2026-09-27-quick-mode-tb-scrutinize.html) — ย้ายมารวมที่นี่
 * ก่อนเริ่มโปรเจกต์ย่อย D (ระดับ standard + ยกระดับอัตโนมัติ) เป็น pure move ไม่เปลี่ยนพฤติกรรม
 */

const LEVEL_PROMPT =
  'ทำแบบไหน? (quick = ทำเลยแบบย่อ 1 task, standard = ออกแบบก่อนแต่ไม่ตรวจ Security design, full = ออกแบบก่อนแบบเต็ม, revise = แก้ requirements)';

export type LevelChoice = 'quick' | 'standard' | 'full' | 'revise';

/** บันทึก log เดียวกันทุกจุดที่ตัดสินระดับงาน (quick/full) — ใช้ร่วมกันระหว่าง requirements.ts และ build.ts */
export function logLevelDecided(
  deps: Deps,
  level: Level,
  by: 'pm' | 'user',
  reason: string | undefined,
  flags: readonly RiskCategory[],
): void {
  (deps.log ?? nullLogger).log('INFO', 'level.decided', { level, by, reason, riskFlags: flags });
}

export function offersQuick(deps: Deps, turn: PmTurn): boolean {
  const pref = deps.levelPreference;
  return pref !== 'full' && pref !== 'standard' && turn.level === 'quick' && turn.quickTask !== undefined;
}

/** PM เสนอ standard (หรือเสนอ quick แต่ user ขอ --standard ซึ่งแปลว่าไม่เอา quick) */
function offersStandard(deps: Deps, turn: PmTurn): boolean {
  if (deps.levelPreference === 'full') return false;
  if (turn.level === 'standard') return true;
  return deps.levelPreference === 'standard' && turn.level === 'quick';
}

/** มีตัวเลือกระดับให้ user เลือก (ไม่ใช่ full ตรง ๆ ซึ่งใช้ confirmAsFull) */
export function offersChoice(deps: Deps, turn: PmTurn): boolean {
  return offersQuick(deps, turn) || offersStandard(deps, turn);
}

/** ตัวเลือกระดับที่เสนอให้ user ตาม turn ปัจจุบัน — quick ถูกเสนอ -> รวม quick, ไม่งั้นมีแค่ standard/full/revise; มี risk flag -> ย้าย full ขึ้นก่อน */
export function levelOptions(deps: Deps, turn: PmTurn, flags: readonly RiskCategory[]): LevelChoice[] {
  const base: LevelChoice[] = offersQuick(deps, turn)
    ? ['quick', 'standard', 'full', 'revise']
    : ['standard', 'full', 'revise'];
  return flags.length ? ['full', ...base.filter((o) => o !== 'full')] : base;
}

/**
 * คืนค่า design/progress ของงาน full เดิม (ก่อนถูก triage เป็น quick) ถ้าเคยเก็บไว้ใน baseDesign/baseProgress
 * แล้วล้าง base ทิ้ง — ใช้ตอนงาน quick ถูกยกระดับกลับเป็น full (PM เสนอ full ใหม่ หรือ escalate ตอน BUILD)
 * ถ้าไม่เคยมี baseDesign (เช่น เริ่มจาก quick มาแต่แรก) พฤติกรรมเดิมคือล้าง design/progress ให้ Planning เริ่มใหม่
 */
export function restoreBaseDesign(state: State): void {
  if (state.baseDesign) {
    state.design = state.baseDesign;
    state.progress = state.baseProgress ?? {};
    // session ของ worker ใน base เก่าเกินจะ resume ต่อ (มีงาน quick คั่น) ให้รอบถัดไปเปิดใหม่
    for (const progress of Object.values(state.progress)) {
      delete progress.workerSessionId;
      delete progress.workerResumes;
      delete progress.reviewedTree;
      delete progress.lastRoundLimit;
    }
  } else {
    state.design = undefined;
    state.progress = {};
  }
  delete state.baseDesign;
  delete state.baseProgress;
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
export async function confirmAsFull(
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

/** ยอมรับ turn นี้เป็นงานที่มีขั้นออกแบบ (standard/full): ล้าง design สังเคราะห์ของ quick แล้วไป DESIGN */
export async function acceptDesignLevel(
  deps: Deps,
  state: State,
  turn: PmTurn,
  level: 'standard' | 'full',
  flags: readonly RiskCategory[] = [],
  by?: 'pm' | 'user',
): Promise<void> {
  const { store, levelPreference } = deps;
  clearStaleQuickDesign(state);
  state.requirements = turn.requirements!;
  state.level = level;
  state.quickTask = undefined;
  state.phase = 'DESIGN';
  await store.saveArtifact('requirements.json', turn.requirements!);
  // turn.level ที่ไม่มีค่า (proposal เปล่า ๆ ไม่ได้ระบุระดับ) ถือว่า PM เสนอ full โดยปริยายเหมือนที่ show() ใช้ t.level ?? 'full'
  // ไม่งั้น full ที่มาจาก confirmAsFull ปกติ (ไม่ผ่าน decideLevel เลย, turn.level เป็น undefined เสมอ) จะถูกนับเป็น 'user' ผิด ๆ
  const decidedBy = by ?? (levelPreference === level || (turn.level ?? 'full') === level ? 'pm' : 'user');
  logLevelDecided(deps, level, levelPreference === level ? 'user' : decidedBy, turn.levelReason, flags);
  await store.save(state);
}

export async function acceptFull(deps: Deps, state: State, turn: PmTurn, flags: readonly RiskCategory[] = []): Promise<void> {
  await acceptDesignLevel(deps, state, turn, 'full', flags);
}

/** PM เสนอ quick: ให้ user เลือก quick/full/revise — true = ตัดสินแล้ว (ไป BUILD หรือ DESIGN), false = revise */
export async function decideLevel(
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
  let options = levelOptions(deps, turn, flags);

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
    if (offersChoice(deps, newTurn) && changed) warn(newFlags);
    if (newFlags.length === 0) {
      riskAppearedMidDecision = false;
    } else if (changed) {
      riskAppearedMidDecision = true;
    }
    flags = newFlags;
    options = levelOptions(deps, newTurn, newFlags);
  };

  let decision = await decide(deps, state, LEVEL_PROMPT, options, onTurn);
  if (decision === 'revise') return false;

  if ((decision === 'quick' || decision === 'standard') && offersChoice(deps, turn) && riskAppearedMidDecision) {
    // user เลือก quick/standard จากตัวเลือกที่เห็นก่อนความเสี่ยงจะโผล่มา (options ยังไม่ได้เรียง full ก่อน): ห้ามรับทันที
    // เตือนอีกครั้งแล้วถามซ้ำด้วยตัวเลือกที่เรียง full ก่อน ยึดคำตอบรอบสองเป็นที่สุด (ไม่ถามวนซ้ำไม่รู้จบ)
    warn(flags);
    decision = await decide(deps, state, LEVEL_PROMPT, levelOptions(deps, turn, flags), onTurn);
    if (decision === 'revise') return false;
  }

  if (decision === 'quick' && !offersQuick(deps, turn)) {
    // PM เปลี่ยนข้อเสนอระหว่างที่ user กำลังตัดสินใจ (ไม่เสนอ quick แล้ว): quick ที่เลือกไว้ใช้ไม่ได้กับ turn ล่าสุด
    // ห้ามยอมรับ quick แบบเงียบ ๆ
    if (offersStandard(deps, turn)) {
      // PM เปลี่ยนไปเสนอ standard แทน (เช่น --standard บังคับ) — ถามใหม่ด้วยตัวเลือกของ turn นั้นแทนที่จะรับ quick เงียบ ๆ
      io.say('PM เปลี่ยนข้อเสนอเป็น standard แล้ว');
      return decideLevel(deps, state, turn, userRisk);
    }
    // ไม่เสนอ standard ด้วย (เหลือแค่ full) — บอก user แล้วถามยืนยันแบบ full ตามปกติ
    io.say('PM เปลี่ยนข้อเสนอเป็น full แล้ว');
    return confirmAsFull(deps, state, turn, flags);
  }

  if (decision === 'standard') {
    await acceptDesignLevel(deps, state, turn, 'standard', flags);
    return true;
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

/**
 * ยกระดับงาน quick กลับเป็น full ตอน escalate ระหว่าง BUILD (QA ไม่ผ่านครบรอบ แล้ว user เลือก full)
 * คืน design/progress ของงาน full เดิมถ้าเคยเก็บไว้ใน baseDesign (ก่อนถูก triage เป็น quick) แทนการล้างทิ้ง
 * เฉย ๆ — ไม่มี baseDesign (เริ่มจาก quick มาแต่แรก) ยังล้างเหมือนเดิมเพื่อไม่ให้ Planning เห็น design
 * สังเคราะห์ของ quick เป็น previousDesign โค้ดที่ worker ทำไปแล้วยังอยู่ในโปรเจกต์ ไม่ได้ถูกลบ แค่บอก
 * Planning ผ่าน designFeedback แทนให้ออกแบบใหม่ตามสมควร
 */
export function escalateToFull(deps: Deps, state: State, task: Task, progress: TaskProgress): void {
  state.level = 'full';
  state.quickTask = undefined;
  state.phase = 'DESIGN';
  restoreBaseDesign(state);
  state.designFeedback =
    `ลองทำแบบ quick (task "${task.title}") แล้วไม่ผ่าน QA ครบ ${progress.rounds} รอบ ` +
    `ปัญหาที่ค้าง: ${JSON.stringify(progress.lastReport?.issues ?? [])} — ` +
    'โค้ดที่ worker ทำไปแล้วยังอยู่ในโปรเจกต์ ให้ออกแบบใหม่โดยใช้หรือแก้โค้ดนั้นตามสมควร';
  logLevelDecided(deps, 'full', 'user', `QA ไม่ผ่านครบ ${progress.rounds} รอบในโหมด quick`, []);
}
