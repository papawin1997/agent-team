import type { AdvisorRunner, UserIO } from '../deps';
import { confirmYesNo } from '../io-util';
import { buildAskResumePrompt } from '../prompts';
import type { Handoff } from '../schemas';
import type { HandoffStore } from './handoff-store';

export interface AskDeps {
  runner: AdvisorRunner;
  io: UserIO;
  store: HandoffStore;
  /** agent-team ask --resume: ให้เลือก handoff ที่เก็บไว้เป็นบริบทของ session ใหม่ */
  resume: boolean;
}

/** exit = จบ, job = ผู้ใช้ยืนยันให้ส่ง handoff ไปเปิดงานใหม่กับทีม */
export type AskOutcome = { kind: 'exit' } | { kind: 'job'; handoff: Handoff };

const HELP = 'คำสั่ง: /save = เก็บ handoff · /job = ส่งต่อเป็นงานให้ทีม · /exit = ออก · /help = ดูคำสั่ง';
const PROMPT = 'ถาม advisor\n> ';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** ข้อความแรกถึง PM ของงานที่มาจาก /job */
export function askJobPrompt(handoff: Handoff): string {
  return (
    '[งานนี้มาจากโหมดปรึกษา (agent-team ask) — handoff ด้านล่างสรุปสิ่งที่ผู้ใช้คุยกับ advisor แล้ว ใช้เป็นคำขอเริ่มต้น]\n\n' +
    `# ${handoff.title}\n\n${handoff.markdown.trim()}`
  );
}

async function pickHandoff(io: UserIO, store: HandoffStore): Promise<string | undefined> {
  const saved = await store.list();
  if (saved.length === 0) {
    io.say('ยังไม่มี handoff ที่เก็บไว้ — เริ่มคุยใหม่', 'system');
    return undefined;
  }
  io.say(['handoff ที่เก็บไว้:', ...saved.map((h, i) => `  ${i + 1}) ${h.title} · ${h.savedAt}`)].join('\n'), 'menu');
  for (;;) {
    const answer = (await io.ask('เลือกเลข handoff (ว่าง = เริ่มคุยใหม่)\n> ')).trim();
    if (answer === '') return undefined;
    const picked = /^\d+$/.test(answer) ? saved[Number(answer) - 1] : undefined;
    if (picked) {
      io.say(`ใช้ handoff "${picked.title}" เป็นบริบท`, 'system');
      return store.read(picked.file);
    }
    io.say('เลือกไม่ถูกต้อง', 'warn');
  }
}

/** loop ของ agent-team ask: คุยกับ advisor (อ่านอย่างเดียว) จนกว่าจะ /exit หรือ /job */
export async function runAsk(deps: AskDeps): Promise<AskOutcome> {
  const { io, runner, store } = deps;
  const context = deps.resume ? await pickHandoff(io, store) : undefined;
  io.say(`โหมดปรึกษา — advisor อ่านโค้ดได้อย่างเดียว ไม่แก้ไฟล์\n${HELP}`, 'system');
  let sessionId: string | undefined;
  /** มีการคุยหลัง handoff ล่าสุด (ใช้ตัดสินว่าจะถามเก็บตอน /exit ไหม) */
  let unsaved = false;
  /** ข้อความที่ advisor ตอบไม่สำเร็จ — กด Enter เพื่อส่งซ้ำ */
  let failed: string | undefined;

  const writeHandoff = async (id: string): Promise<Handoff | undefined> => {
    try {
      const out = await runner.handoff(id);
      sessionId = out.sessionId;
      const file = await store.save(out.handoff);
      unsaved = false;
      io.say(`เก็บ handoff ที่ ${file}`, 'success');
      return out.handoff;
    } catch (e) {
      io.say(`เขียน handoff ไม่สำเร็จ (${errMessage(e)})`, 'error');
      return undefined;
    }
  };

  for (;;) {
    const raw = (await io.ask(PROMPT)).trim();
    const input = raw === '' ? failed : raw;
    if (input === undefined) continue;
    const command = input.toLowerCase();

    if (command === '/exit' || command === '/quit') {
      if (sessionId && unsaved && (await confirmYesNo(io, 'เก็บ handoff ของการคุยนี้ไหม? (y/n)\n> '))) {
        await writeHandoff(sessionId);
      }
      return { kind: 'exit' };
    }
    if (command === '/help') {
      io.say(HELP, 'system');
      continue;
    }
    if (command === '/save' || command === '/job') {
      if (!sessionId) {
        io.say('ยังไม่ได้คุยกับ advisor — ถามอะไรสักอย่างก่อน', 'warn');
        continue;
      }
      const handoff = await writeHandoff(sessionId);
      if (!handoff || command === '/save') continue;
      io.say(`# ${handoff.title}\n\n${handoff.markdown}`, 'advisor');
      if (await confirmYesNo(io, 'ส่ง handoff นี้ให้ PM เริ่มงานใหม่ไหม? (y/n)\n> ')) return { kind: 'job', handoff };
      continue;
    }
    if (input.startsWith('/')) {
      io.say(`ไม่รู้จักคำสั่ง ${input} — ${HELP}`, 'warn');
      continue;
    }

    const prompt = context !== undefined && sessionId === undefined ? buildAskResumePrompt(context, input) : input;
    try {
      const out = await runner.advise({ prompt, sessionId });
      sessionId = out.sessionId;
      unsaved = true;
      failed = undefined;
      io.say(out.text, 'advisor');
    } catch (e) {
      failed = input;
      io.say(
        `advisor ตอบไม่สำเร็จ (${errMessage(e)}) — กด Enter เพื่อส่งข้อความเดิมอีกครั้ง หรือพิมพ์ข้อความใหม่ ` +
          '(ถ้าชนขีดจำกัด ให้ /save แล้วเริ่มใหม่ด้วย agent-team ask --resume)',
        'error',
      );
    }
  }
}
