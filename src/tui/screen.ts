import type { AgentRun } from './agent-block';
import type { MenuOption } from './menu';
import type { BarInfo } from './status-bar';

/** ข้อความที่พิมพ์ลงจอแล้ว (ลงสีแล้ว) — Ink พิมพ์แบบถาวรด้วย Static */
export interface LogLine {
  id: number;
  text: string;
}

/** agent ที่กำลังทำงาน (จาก StatusSink) */
/** agent ที่กำลังทำงาน (จาก StatusSink) */
export type Activity = AgentRun;

export type PromptSpec =
  | { kind: 'text'; prompt: string }
  | { kind: 'menu'; prompt: string; options: MenuOption[]; allowText: boolean };
export type PromptRequest = PromptSpec & { id: number };
export type MenuPrompt = Extract<PromptRequest, { kind: 'menu' }>;
export type PromptAnswer = { text: string } | { choice: string };

export interface ScreenState {
  log: readonly LogLine[];
  /** คำถามที่รอคำตอบ (มีได้ทีละคำถาม) */
  prompt?: PromptRequest;
  activity?: Activity;
  /** ข้อความเตือนสั้น ๆ ใต้ช่องพิมพ์ (หายเมื่อมีคำถามใหม่) */
  notice?: string;
  /** ปิดจอแล้ว: เหลือแต่ log */
  closed?: boolean;
  /** แถบสถานะล่างจอ */
  bar: BarInfo;
  /** เวลาเริ่มรัน (ใช้คำนวณเวลาในแถบสถานะ) */
  startedAt: number;
}

export interface Mounted {
  unmount(): void;
}

/** สถานะจอที่ TuiIO เขียนและ App (Ink) อ่าน — แยกจาก Ink เพื่อให้เทสต์ได้โดยไม่ต้องมี terminal */
export class ScreenStore {
  private state: ScreenState;
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  private pending: { resolve: (answer: PromptAnswer) => void; reject: (error: Error) => void } | undefined;

  constructor(now: () => number = Date.now) {
    this.state = { log: [], bar: {}, startedAt: now() };
  }

  readonly getState = (): ScreenState => this.state;

  setBar(patch: Partial<BarInfo>): void {
    this.set({ bar: { ...this.state.bar, ...patch } });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  print(text: string): void {
    this.set({ log: [...this.state.log, { id: this.nextId++, text }] });
  }

  setActivity(activity: Activity | undefined): void {
    this.set({ activity });
  }

  setNotice(notice: string | undefined): void {
    this.set({ notice });
  }

  request(spec: PromptSpec): Promise<PromptAnswer> {
    if (this.state.closed) return Promise.reject(new Error('หน้าจอปิดแล้ว'));
    if (this.pending) return Promise.reject(new Error('มีคำถามค้างอยู่แล้ว'));
    return new Promise<PromptAnswer>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.set({ prompt: { ...spec, id: this.nextId++ }, notice: undefined });
    });
  }

  answer(answer: PromptAnswer): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    this.set({ prompt: undefined });
    pending.resolve(answer);
  }

  close(error: Error): void {
    const pending = this.pending;
    this.pending = undefined;
    this.set({ prompt: undefined, activity: undefined, notice: undefined, closed: true });
    pending?.reject(error);
  }

  private set(patch: Partial<ScreenState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
