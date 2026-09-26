import type { RoleName } from './config';

/** รับสถานะของ agent ที่กำลังทำงาน (CliIO แสดงเป็น spinner) */
export interface StatusSink {
  start(label: string): void;
  update(detail: string): void;
  stop(): void;
}

export const nullStatus: StatusSink = { start: () => {}, update: () => {}, stop: () => {} };

/** carriage return + ลบทั้งบรรทัด */
export const ERASE_LINE = '\r\x1b[2K';

const MAX_DETAIL = 60;
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 100;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** ตัดท้าย: คำสั่ง/pattern ส่วนต้นสำคัญกว่า */
function head(text: string, max = MAX_DETAIL): string {
  const chars = Array.from(oneLine(text));
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

/** ตัดหัว: path ชื่อไฟล์ท้ายสุดสำคัญกว่า */
function tail(text: string, max = MAX_DETAIL): string {
  const chars = Array.from(oneLine(text));
  return chars.length > max ? `…${chars.slice(chars.length - max + 1).join('')}` : chars.join('');
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/** แปลง tool_use ของ agent เป็นข้อความสั้น ๆ สำหรับบรรทัดสถานะ */
export function describeToolUse(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const file = str(args.file_path) ?? str(args.notebook_path);
  switch (name) {
    case 'Read':
      return file ? `อ่านไฟล์ ${tail(file)}` : 'อ่านไฟล์';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return file ? `แก้ไฟล์ ${tail(file)}` : 'แก้ไฟล์';
    case 'Bash': {
      const command = str(args.command);
      return command ? `รันคำสั่ง ${head(command)}` : 'รันคำสั่ง';
    }
    case 'Grep':
    case 'Glob': {
      const pattern = str(args.pattern);
      return pattern ? `ค้นหา ${head(pattern)}` : 'ค้นหา';
    }
    case 'Skill': {
      const skill = str(args.skill);
      return skill ? `ใช้ skill ${head(skill)}` : 'ใช้ skill';
    }
    case 'StructuredOutput':
      return 'สรุปผลลัพธ์';
    default:
      return `ใช้ tool ${name}`;
  }
}

/** ชื่อที่ขึ้นในบรรทัดสถานะ worker ใช้ชื่อ role ตรง ๆ เหมือนข้อความใน phases/build.ts */
export function agentLabel(role: RoleName, taskId?: string): string {
  const task = taskId ? ` ${taskId}:` : '';
  switch (role) {
    case 'pm':
      return '[PM] กำลังคิด';
    case 'planning':
      return '[Planning] กำลังออกแบบ';
    case 'qa':
      return `[QA]${task} กำลังตรวจ`;
    case 'security':
      return taskId ? `[Security]${task} กำลังตรวจความปลอดภัย` : '[Security] กำลังตรวจ design';
    default:
      return `[${role}]${task} กำลังทำงาน`;
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}

export interface SpinnerOptions {
  output: NodeJS.WritableStream;
  /** false = ไม่หมุน พิมพ์บรรทัดเดียวตอน start (pipe/redirect) */
  tty: boolean;
  /** ความกว้าง terminal (undefined = ไม่ตัด) */
  columns?: () => number | undefined;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/** บรรทัดสถานะบรรทัดเดียวที่วาดทับที่เดิม: "⠹ [QA] T2: กำลังตรวจ 1m23s · อ่านไฟล์ a.ts" */
export class Spinner implements StatusSink {
  private label: string | undefined;
  private detail: string | undefined;
  private startedAt = 0;
  private frame = 0;
  private timer: unknown;
  private drawn = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: SpinnerOptions) {
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms).unref());
    this.clearTimer = opts.clearInterval ?? ((handle) => clearInterval(handle as NodeJS.Timeout));
  }

  get active(): boolean {
    return this.label !== undefined;
  }

  start(label: string): void {
    this.stop();
    this.label = label;
    this.startedAt = this.now();
    this.frame = 0;
    if (!this.opts.tty) {
      this.opts.output.write(`${label}...\n`);
      return;
    }
    this.render();
    this.timer = this.setTimer(() => {
      this.frame++;
      this.render();
    }, FRAME_MS);
  }

  update(detail: string): void {
    if (!this.active) return;
    this.detail = detail;
    if (this.opts.tty) this.render();
  }

  stop(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    this.clear();
    this.label = undefined;
    this.detail = undefined;
  }

  /** ลบบรรทัด spinner ชั่วคราว ก่อนพิมพ์ข้อความอื่น */
  clear(): void {
    if (!this.drawn) return;
    this.opts.output.write(ERASE_LINE);
    this.drawn = false;
  }

  /** วาดกลับหลังพิมพ์ข้อความอื่น ถ้ายังหมุนอยู่ */
  redraw(): void {
    if (this.opts.tty && this.active) this.render();
  }

  private render(): void {
    const frame = FRAMES[this.frame % FRAMES.length];
    const elapsed = formatElapsed(this.now() - this.startedAt);
    const detail = this.detail ? ` · ${this.detail}` : '';
    this.opts.output.write(`${ERASE_LINE}${this.fit(`${frame} ${this.label} ${elapsed}${detail}`)}`);
    this.drawn = true;
  }

  /** ตัดให้สั้นกว่าความกว้าง terminal 1 ตัว ไม่ให้ขึ้นบรรทัดใหม่เอง (นับเป็น code point) */
  private fit(line: string): string {
    const columns = this.opts.columns?.();
    if (!columns) return line;
    const chars = Array.from(line);
    const max = columns - 1;
    return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : line;
  }
}
