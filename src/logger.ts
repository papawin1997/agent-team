import * as fs from 'node:fs';
import * as path from 'node:path';
import type { UserIO } from './deps';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface Logger {
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void;
}

export const nullLogger: Logger = { log() {} };

const MAX_STRING = 1000;

function truncate(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}…(ตัด ${value.length - MAX_STRING} ตัวอักษร)`;
  }
  return value;
}

/** ต่อท้ายไฟล์ทีละบรรทัด: `เวลา LEVEL event {json}` เขียนแบบ sync เพื่อให้ทันก่อน process.exit ตอน Ctrl+C */
export class FileLogger implements Logger {
  private dirReady = false;

  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    try {
      if (!this.dirReady) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        this.dirReady = true;
      }
      const tail = data === undefined ? '' : ` ${JSON.stringify(data, truncate)}`;
      fs.appendFileSync(this.file, `${this.now().toISOString()} ${level.padEnd(5)} ${event}${tail}\n`, 'utf8');
    } catch {
      // log เขียนไม่ได้ต้องไม่ทำให้งานล้ม
    }
  }
}

/** ครอบ UserIO เพื่อบันทึกทุกข้อความที่แสดงและทุกคำตอบของ user */
export class LoggingIO implements UserIO {
  constructor(
    private readonly inner: UserIO,
    private readonly logger: Logger,
  ) {}

  say(text: string): void {
    this.inner.say(text);
    this.logger.log('INFO', 'say', { text });
  }

  async ask(prompt: string): Promise<string> {
    const answer = await this.inner.ask(prompt);
    this.logger.log('INFO', 'user.input', { prompt, answer });
    return answer;
  }

  async choose<T extends string>(prompt: string, options: readonly T[]): Promise<T> {
    const choice = await this.inner.choose(prompt, options);
    this.logger.log('INFO', 'user.choice', { prompt, choice });
    return choice;
  }

  async chooseOrText<T extends string>(prompt: string, options: readonly T[]): Promise<T | { text: string }> {
    const result = await this.inner.chooseOrText(prompt, options);
    if (typeof result === 'string') {
      this.logger.log('INFO', 'user.choice', { prompt, choice: result });
    } else {
      this.logger.log('INFO', 'user.question', { prompt, question: result.text });
    }
    return result;
  }
}
