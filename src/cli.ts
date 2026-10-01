import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import { Spinner } from './activity';
import type { UserIO } from './deps';
import { colorEnabled, plainText, type SayKind, type Styler, styler, styleSay, stylePrompt } from './style';

const LABELS: Record<string, string> = {
  confirm: 'ยืนยัน',
  revise: 'ขอแก้',
  accept: 'รับงาน',
  change: 'ขอแก้/เพิ่ม',
  continue: 'ทำต่อ',
  abort: 'ยกเลิก',
};

const EOF_MESSAGE = 'stdin ถูกปิด (EOF) — หยุดการทำงาน';

export function parseChoice<T extends string>(input: string, options: readonly T[]): T | undefined {
  const text = input.trim().replace(/[.)]+$/, '');
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (n >= 1 && n <= options.length) return options[n - 1];
  }
  const lower = text.toLowerCase();
  return options.find((o) => o.toLowerCase() === lower || LABELS[o] === text);
}

export interface CliIOOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** ค่าเริ่มต้น = output เป็น TTY หรือไม่ (ตาม readline) */
  terminal?: boolean;
  /** เรียกเมื่อกด Ctrl+C ค่าเริ่มต้นยิง process 'SIGINT' ให้ handler ใน index.ts ทำงาน */
  onInterrupt?: () => void;
  /** ใส่สีหรือไม่ ค่าเริ่มต้น = colorEnabled(output) (เป็น TTY และไม่มี NO_COLOR) */
  color?: boolean;
}

export class CliIO implements UserIO {
  private readonly rl: readline.Interface;
  private readonly output: NodeJS.WritableStream;
  private isClosed = false;
  private readonly closed: Promise<never>;
  /** บรรทัดสถานะระหว่าง agent ทำงาน index.ts ส่งให้ SdkRoleRunner ตรง ๆ (ไม่ผ่าน LoggingIO จึงไม่ลง log) */
  readonly status: Spinner;
  /** undefined = ไม่ใส่สี (ได้ข้อความเหมือนก่อนมีสีทุกตัวอักษร) */
  private readonly style: Styler | undefined;

  constructor(options: CliIOOptions = {}) {
    this.output = options.output ?? stdout;
    const screen = this.output as Partial<NodeJS.WriteStream>;
    this.style = (options.color ?? colorEnabled(screen)) ? styler(true) : undefined;
    this.status = new Spinner({
      output: this.output,
      tty: options.terminal ?? screen.isTTY === true,
      columns: () => screen.columns,
    });
    this.rl = readline.createInterface({
      input: options.input ?? stdin,
      output: this.output,
      terminal: options.terminal,
    });
    // ใน terminal (raw) mode Ctrl+C ไม่ใช่ SIGINT ของ process แต่ readline รับเป็นปุ่มและปิดตัวเอง
    // ถ้าไม่มี listener จึงต้องส่งต่อให้ handler เดียวกับ SIGINT
    const onInterrupt = options.onInterrupt ?? (() => process.emit('SIGINT'));
    this.rl.on('SIGINT', () => onInterrupt());
    this.closed = new Promise<never>((_, reject) => {
      this.rl.once('close', () => {
        this.isClosed = true;
        reject(new Error(EOF_MESSAGE));
      });
    });
    // ปิดเองตอนจบงานก็ต้องไม่กลายเป็น unhandled rejection
    this.closed.catch(() => {});
  }

  say(text: string, kind?: SayKind): void {
    this.status.clear();
    const out = this.style ? styleSay(text, kind, this.style) : plainText(text, kind);
    this.output.write(`${out}\n`);
    this.status.redraw();
  }

  async ask(prompt: string): Promise<string> {
    this.status.stop();
    if (this.isClosed) throw new Error(EOF_MESSAGE);
    const shown = this.style ? stylePrompt(prompt, this.style) : prompt;
    return (await Promise.race([this.rl.question(shown), this.closed])).trim();
  }

  async chooseOrText<T extends string>(prompt: string, options: readonly T[]): Promise<T | { text: string }> {
    const menu = options.map((o, i) => `${i + 1}) ${o}${LABELS[o] ? ` (${LABELS[o]})` : ''}`).join('   ');
    const text = `${prompt}\n${menu}\nหรือพิมพ์คำถาม/ความเห็นถึง PM ก่อนตัดสินใจก็ได้\n> `;
    const answer = await this.ask(this.style ? `\n${text}` : text);
    const choice = parseChoice(answer, options);
    return choice ?? { text: answer };
  }

  async choose<T extends string>(prompt: string, options: readonly T[]): Promise<T> {
    for (;;) {
      const result = await this.chooseOrText(prompt, options);
      if (typeof result === 'string') return result;
      this.say('กรุณาพิมพ์หมายเลขหรือชื่อตัวเลือกให้ตรง', 'warn');
    }
  }

  close(): void {
    this.status.stop();
    this.rl.close();
  }
}
