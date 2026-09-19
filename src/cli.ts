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

export interface CliIOStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export class CliIO implements UserIO {
  private readonly rl: readline.Interface;
  private isClosed = false;
  private readonly closed: Promise<never>;

  constructor(streams: CliIOStreams = {}) {
    this.rl = readline.createInterface({
      input: streams.input ?? stdin,
      output: streams.output ?? stdout,
    });
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
    console.log(text);
  }

  async ask(prompt: string): Promise<string> {
    if (this.isClosed) throw new Error(EOF_MESSAGE);
    return (await Promise.race([this.rl.question(prompt), this.closed])).trim();
  }

  async choose<T extends string>(prompt: string, options: readonly T[]): Promise<T> {
    const menu = options.map((o, i) => `${i + 1}) ${o}${LABELS[o] ? ` (${LABELS[o]})` : ''}`).join('   ');
    for (;;) {
      const answer = await this.ask(`${prompt}\n${menu}\n> `);
      const choice = parseChoice(answer, options);
      if (choice) return choice;
      this.say('กรุณาพิมพ์หมายเลขหรือชื่อตัวเลือกให้ตรง');
    }
  }

  close(): void {
    this.rl.close();
  }
}
