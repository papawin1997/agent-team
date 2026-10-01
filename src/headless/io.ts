import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import type { StatusSink } from '../activity';
import { parseChoice } from '../cli';
import type { UserIO } from '../deps';
import { plainText, type SayKind } from '../style';
import {
  appendEvent,
  headlessPath,
  lastEventSeq,
  readJsonSafe,
  removeQuietly,
  writeJsonAtomic,
  type Activity,
  type Answer,
  type Question,
  type QuestionKind,
} from './files';

export class HeadlessIdleError extends Error {
  constructor(minutes: number) {
    super(`รอคำตอบเกิน ${minutes} นาที`);
    this.name = 'HeadlessIdleError';
  }
}

export interface HeadlessIOOptions {
  /** โฟลเดอร์งาน .agent-team/jobs/<id>/ */
  dir: string;
  /** รอคำตอบนานสุดเท่านี้ แล้วโยน HeadlessIdleError (กัน process ค้างถ้าไม่มีใครตอบ) */
  idleTimeoutMs: number;
  pollMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** UserIO ของโหมด headless: ไม่แตะ stdin/stdout คุยกับคำสั่ง wait/answer ผ่านไฟล์ในโฟลเดอร์งาน */
export class HeadlessIO implements UserIO {
  private seq: number;
  private readonly pollMs: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newId: () => string;

  constructor(private readonly opts: HeadlessIOOptions) {
    this.pollMs = opts.pollMs ?? 500;
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? defaultSleep;
    this.newId = opts.newId ?? randomUUID;
    fs.mkdirSync(opts.dir, { recursive: true });
    // มี events.jsonl ตั้งแต่เริ่ม = resolveJob รู้ว่าเป็นงาน headless แม้ยังไม่ได้ say อะไร
    fs.appendFileSync(headlessPath(opts.dir, 'events'), '', 'utf8');
    this.seq = lastEventSeq(opts.dir);
    // คำถาม/คำตอบค้างจาก process ก่อน (ตาย/ถูก kill) ใช้ต่อไม่ได้ คำถามใหม่จะได้ id ใหม่
    removeQuietly(headlessPath(opts.dir, 'question'));
    removeQuietly(headlessPath(opts.dir, 'answer'));
  }

  /** seq ของ event ล่าสุด (ส่งให้ Claude Code เป็นค่า --since เริ่มต้น) */
  get lastSeq(): number {
    return this.seq;
  }

  say(text: string, kind?: SayKind): void {
    this.seq += 1;
    appendEvent(this.opts.dir, { seq: this.seq, at: this.now().toISOString(), text: plainText(text, kind) });
  }

  ask(prompt: string): Promise<string> {
    return this.waitAnswer('text', prompt);
  }

  async choose<T extends string>(prompt: string, options: readonly T[]): Promise<T> {
    for (;;) {
      const text = await this.waitAnswer('choice', prompt, options);
      const choice = parseChoice(text, options);
      if (choice) return choice;
      this.say(`"${text}" ไม่อยู่ในตัวเลือก: ${options.join(', ')}`, 'warn');
    }
  }

  async chooseOrText<T extends string>(prompt: string, options: readonly T[]): Promise<T | { text: string }> {
    const text = await this.waitAnswer('choiceOrText', prompt, options);
    return parseChoice(text, options) ?? { text };
  }

  private async waitAnswer(kind: QuestionKind, prompt: string, options?: readonly string[]): Promise<string> {
    const { dir, idleTimeoutMs } = this.opts;
    const questionFile = headlessPath(dir, 'question');
    const answerFile = headlessPath(dir, 'answer');
    const question: Question = { id: this.newId(), kind, prompt, askedAt: this.now().toISOString() };
    if (options) question.options = [...options];
    // answer.json ค้าง (ลบไม่สำเร็จจากรอบก่อน) ต้องไม่อยู่ตอนคำถามใหม่ปรากฏ ไม่งั้นคำสั่ง answer/status สับสน
    removeQuietly(answerFile);
    writeJsonAtomic(questionFile, question);
    const deadline = this.now().getTime() + idleTimeoutMs;
    for (;;) {
      const answer = readJsonSafe<Answer>(answerFile);
      if (answer?.questionId === question.id && typeof answer.text === 'string') {
        // ลบคำถามก่อนคำตอบ: ช่วงรอยต่อ status จะเห็นเป็น running ไม่ใช่คำถามที่ยังไม่มีคนตอบ
        removeQuietly(questionFile);
        removeQuietly(answerFile);
        return answer.text;
      }
      if (this.now().getTime() >= deadline) {
        removeQuietly(questionFile);
        removeQuietly(answerFile);
        throw new HeadlessIdleError(Math.round(idleTimeoutMs / 60_000));
      }
      await this.sleep(this.pollMs);
    }
  }
}

/**
 * StatusSink ของ headless: เขียน agent ที่กำลังทำงาน + tool ล่าสุดลง activity.json ให้ wait/status แสดง
 * สร้างก่อนรู้ jobId (runner ต้องได้ status ตอนสร้าง) แล้ว attach โฟลเดอร์งานทีหลัง ก่อน attach เป็น no-op
 */
export class ActivityStatus implements StatusSink {
  private dir: string | undefined;
  private label: string | undefined;

  constructor(private readonly now: () => Date = () => new Date()) {}

  attach(dir: string): void {
    this.dir = dir;
  }

  start(label: string): void {
    this.label = label;
    this.write(undefined);
  }

  update(detail: string): void {
    if (this.label !== undefined) this.write(detail);
  }

  stop(): void {
    this.label = undefined;
    if (this.dir) removeQuietly(headlessPath(this.dir, 'activity'));
  }

  private write(detail: string | undefined): void {
    if (!this.dir || this.label === undefined) return;
    const activity: Activity = { label: this.label, at: this.now().toISOString() };
    if (detail !== undefined) activity.detail = detail;
    try {
      writeJsonAtomic(headlessPath(this.dir, 'activity'), activity);
    } catch {
      // activity เป็นแค่ข้อมูลประกอบ เขียนไม่ได้ต้องไม่ทำให้ agent ล้ม
    }
  }
}
