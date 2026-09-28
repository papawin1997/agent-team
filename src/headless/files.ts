import * as fs from 'node:fs';
import * as path from 'node:path';
import { renameWithRetrySync } from '../fs-retry';

/** ไฟล์สื่อสารระหว่าง process headless กับคำสั่ง wait/status/answer/stop (อยู่ใน .agent-team/jobs/<id>/) */
export const HEADLESS_FILES = {
  events: 'events.jsonl',
  question: 'question.json',
  answer: 'answer.json',
  activity: 'activity.json',
  exit: 'exit.json',
  stop: 'stop.json',
} as const;

export type HeadlessFile = keyof typeof HEADLESS_FILES;

export const headlessPath = (dir: string, file: HeadlessFile): string => path.join(dir, HEADLESS_FILES[file]);

/** text = ข้อความอิสระ, choice = ต้องเป็นหนึ่งใน options, choiceOrText = ตัวเลือกหรือข้อความถึง PM */
export type QuestionKind = 'text' | 'choice' | 'choiceOrText';

export interface Question {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options?: string[];
  askedAt: string;
}

export interface Answer {
  questionId: string;
  text: string;
}

export interface HeadlessEvent {
  seq: number;
  at: string;
  text: string;
}

export type ExitStatus = 'done' | 'aborted' | 'error' | 'stopped' | 'idle';

export interface ExitInfo {
  status: ExitStatus;
  message?: string;
  at: string;
}

export interface Activity {
  label: string;
  detail?: string;
  at: string;
}

/**
 * เขียนไฟล์ชั่วคราวแล้ว rename ทับ ผู้อ่านจึงเห็นแต่ไฟล์เก่าทั้งก้อนหรือไฟล์ใหม่ทั้งก้อน
 * Windows: rename ทับไฟล์ที่อีก process เปิดอ่านอยู่อาจได้ EPERM/EBUSY ชั่วครู่ จึง retry สั้น ๆ (ดู fs-retry)
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  renameWithRetrySync(tmp, file);
}

/** ไม่มีไฟล์ อ่านไม่ได้ หรือ JSON พัง → undefined (ห้าม throw: อีก process อาจกำลังเขียน/ลบอยู่) */
export function readJsonSafe<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // best-effort: ไฟล์ถูกเปิดค้างอยู่ก็ปล่อยไว้
  }
}

/** อ่าน events.jsonl คืนเฉพาะ seq > since ข้ามบรรทัดที่ parse ไม่ได้ (เช่นบรรทัดท้ายที่เขียนยังไม่จบ) */
export function readEvents(dir: string, since = 0): HeadlessEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(headlessPath(dir, 'events'), 'utf8');
  } catch {
    return [];
  }
  const events: HeadlessEvent[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const event = JSON.parse(line) as HeadlessEvent;
      if (typeof event.seq === 'number' && event.seq > since) events.push(event);
    } catch {
      // บรรทัดพัง/ยังเขียนไม่จบ
    }
  }
  return events;
}

export function lastEventSeq(dir: string): number {
  return readEvents(dir).reduce((max, e) => Math.max(max, e.seq), 0);
}

export function appendEvent(dir: string, event: HeadlessEvent): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(headlessPath(dir, 'events'), `${JSON.stringify(event)}\n`, 'utf8');
}

export function writeExit(dir: string, status: ExitStatus, message?: string, now: Date = new Date()): void {
  const at = now.toISOString();
  const info: ExitInfo = message === undefined ? { status, at } : { status, message, at };
  writeJsonAtomic(headlessPath(dir, 'exit'), info);
}
