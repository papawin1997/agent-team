import { formatElapsed, type StatusSink } from '../activity';
import { CHOICE_LABELS, EOF_MESSAGE } from '../cli';
import type { UserIO } from '../deps';
import { formatQuotaShort, type RateLimitInfo } from '../quota';
import type { State } from '../state';
import { type SayKind, type Styler, styler, styleSay } from '../style';
import { finishedBlock } from './agent-block';
import type { MenuOption } from './menu';
import { type Mounted, type PromptAnswer, type PromptSpec, ScreenStore } from './screen';
import { jobBar } from './status-bar';

export interface TuiIOOptions {
  store?: ScreenStore;
  /** ใส่สี ANSI ใน log (ค่าเริ่มต้น true) */
  color?: boolean;
  /** เปิดจอ (index ใช้ mountApp ของ Ink ; เทสต์ส่งตัวปลอม) */
  mount: (store: ScreenStore) => Mounted;
  now?: () => number;
}

/** prompt ของ readline มี "> " ท้าย — UI ใหม่มีช่องพิมพ์อยู่แล้วจึงตัดออก */
export function cleanPrompt(prompt: string): string {
  return prompt.replace(/\s*>\s*$/, '').trimEnd();
}

export function menuOptions(options: readonly string[]): MenuOption[] {
  return options.map((value) => {
    const label = CHOICE_LABELS[value];
    return label ? { value, label } : { value };
  });
}

/** UserIO + StatusSink ของ UI ใหม่: เขียนสถานะลง ScreenStore และรอคำตอบจากจอ */
export class TuiIO implements UserIO {
  readonly store: ScreenStore;
  readonly status: StatusSink;
  private readonly s: Styler;
  private readonly mounted: Mounted;
  private closed = false;

  constructor(o: TuiIOOptions) {
    const now = o.now ?? Date.now;
    this.store = o.store ?? new ScreenStore(now);
    this.s = styler(o.color ?? true);
    this.status = {
      start: (label) => this.store.setActivity({ label, startedAt: now(), tools: [] }),
      update: (detail) => {
        const current = this.store.getState().activity;
        if (current) this.store.setActivity({ ...current, tools: [...current.tools, detail] });
      },
      stop: (ok = true) => {
        const current = this.store.getState().activity;
        if (!current) return;
        this.store.setActivity(undefined);
        const block = finishedBlock(current, ok, formatElapsed(now() - current.startedAt), this.s);
        if (block) this.store.print(block);
      },
    };
    this.mounted = o.mount(this.store);
  }

  say(text: string, kind?: SayKind): void {
    this.store.print(styleSay(text, kind, this.s));
  }

  /** แถบสถานะ: งาน (เรียกทุกครั้งที่ state ถูกบันทึก) — ล้างค่าเก่าที่ไม่มีแล้ว เช่นจำนวนงานหลังออกจาก BUILD */
  showJob(state: State): void {
    this.store.setBar({ title: undefined, tasks: undefined, ...jobBar(state) });
  }

  showQuota(info: RateLimitInfo): void {
    this.store.setBar({ quota: formatQuotaShort(info) });
  }

  /** โหมดที่ไม่มีงาน เช่น "ปรึกษา" */
  showMode(label: string): void {
    this.store.setBar({ phase: label });
  }

  async ask(prompt: string): Promise<string> {
    const answer = await this.request({ kind: 'text', prompt: cleanPrompt(prompt) });
    const text = ('text' in answer ? answer.text : answer.choice).trim();
    this.store.print(this.s.dim(`> ${text}`));
    return text;
  }

  async chooseOrText<T extends string>(prompt: string, options: readonly T[]): Promise<T | { text: string }> {
    const answer = await this.request({ kind: 'menu', prompt: cleanPrompt(prompt), options: menuOptions(options), allowText: true });
    if ('choice' in answer) return this.chosen(answer.choice as T);
    const text = answer.text.trim();
    this.store.print(this.s.dim(`> ${text}`));
    return { text };
  }

  async choose<T extends string>(prompt: string, options: readonly T[]): Promise<T> {
    const answer = await this.request({ kind: 'menu', prompt: cleanPrompt(prompt), options: menuOptions(options), allowText: false });
    if (!('choice' in answer)) throw new Error('คำถามนี้ต้องเลือกจากตัวเลือกเท่านั้น');
    return this.chosen(answer.choice as T);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.store.close(new Error(EOF_MESSAGE));
    this.mounted.unmount();
  }

  private chosen<T extends string>(choice: T): T {
    const label = CHOICE_LABELS[choice];
    this.store.print(this.s.dim(`เลือก: ${label ?? choice} (${choice})`));
    return choice;
  }

  private request(spec: PromptSpec): Promise<PromptAnswer> {
    if (this.closed) return Promise.reject(new Error(EOF_MESSAGE));
    return this.store.request(spec);
  }
}
