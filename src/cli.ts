import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import type { UserIO } from './deps';

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
  const text = input.trim();
  const n = Number(text);
  if (text !== '' && Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
  return options.find((o) => o === text);
}

export interface CliIOOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** ค่าเริ่มต้น = output เป็น TTY หรือไม่ (ตาม readline) */
  terminal?: boolean;
  /** เรียกเมื่อกด Ctrl+C ค่าเริ่มต้นยิง process 'SIGINT' ให้ handler ใน index.ts ทำงาน */
  onInterrupt?: () => void;
}

export class CliIO implements UserIO {
  private readonly rl: readline.Interface;
  private readonly output: NodeJS.WritableStream;
  private isClosed = false;
  private readonly closed: Promise<never>;

  constructor(options: CliIOOptions = {}) {
    this.output = options.output ?? stdout;
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

  say(text: string): void {
    this.output.write(`${text}\n`);
  }

  async ask(prompt: string): Promise<string> {
    if (this.isClosed) throw new Error(EOF_MESSAGE);
    return (await Promise.race([this.rl.question(prompt), this.closed])).trim();
  }

  async chooseOrText<T extends string>(prompt: string, options: readonly T[]): Promise<T | { text: string }> {
    const menu = options.map((o, i) => `${i + 1}) ${o}${LABELS[o] ? ` (${LABELS[o]})` : ''}`).join('   ');
    const answer = await this.ask(`${prompt}\n${menu}\nหรือพิมพ์คำถาม/ความเห็นถึง PM ก่อนตัดสินใจก็ได้\n> `);
    const choice = parseChoice(answer, options);
    return choice ?? { text: answer };
  }

  async choose<T extends string>(prompt: string, options: readonly T[]): Promise<T> {
    for (;;) {
      const result = await this.chooseOrText(prompt, options);
      if (typeof result === 'string') return result;
      this.say('กรุณาพิมพ์หมายเลขหรือชื่อตัวเลือกให้ตรง');
    }
  }

  close(): void {
    this.rl.close();
  }
}
