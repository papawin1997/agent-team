import * as path from 'node:path';
import { JOB_ID_RE } from '../jobs';

/** ค่าเริ่มต้นของ wait ต้องต่ำกว่า timeout สูงสุดของ Bash tool ใน Claude Code (600 วินาที) */
export const DEFAULT_WAIT_SEC = 540;
export const MAX_WAIT_SEC = 3600;

export const HEADLESS_COMMANDS = ['wait', 'status', 'answer', 'stop', 'install-skill'] as const;
export type HeadlessCommandName = (typeof HEADLESS_COMMANDS)[number];

export type HeadlessCommand =
  | { command: 'wait' | 'status'; projectDir: string; job?: string; since?: number; timeoutSec: number }
  | { command: 'answer'; projectDir: string; job?: string; text: string }
  | { command: 'stop'; projectDir: string; job?: string }
  | { command: 'install-skill' };

export const isHeadlessCommand = (word: string | undefined): word is HeadlessCommandName =>
  (HEADLESS_COMMANDS as readonly string[]).includes(word ?? '');

function intArg(flag: string, value: string | undefined, min: number, max: number): number {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${flag} ต้องเป็นจำนวนเต็ม`);
  const n = Number(value);
  if (n < min || n > max) throw new Error(`${flag} ต้องอยู่ระหว่าง ${min}-${max}`);
  return n;
}

/** agent-team wait|status|answer|stop|install-skill (argv[0] คือชื่อคำสั่ง) */
export function parseHeadlessCommand(argv: string[]): HeadlessCommand {
  const [command, ...rest] = argv;
  if (!isHeadlessCommand(command)) throw new Error(`คำสั่งไม่รู้จัก: ${command ?? ''}`);
  if (command === 'install-skill') {
    if (rest.length > 0) throw new Error('install-skill ไม่รับอาร์กิวเมนต์');
    return { command };
  }
  let projectDir = '.';
  let job: string | undefined;
  let since: number | undefined;
  let timeoutSec: number | undefined;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? '';
    if (arg === '--') {
      positional.push(...rest.slice(i + 1));
      break;
    }
    if (arg === '--project') {
      const value = rest[++i];
      if (value === undefined || value === '' || value.startsWith('-')) throw new Error('ต้องระบุพาธหลัง --project');
      projectDir = value;
    } else if (arg === '--job') {
      const value = rest[++i];
      if (value === undefined || !JOB_ID_RE.test(value)) throw new Error(`jobId ไม่ถูกรูปแบบ: ${value ?? ''}`);
      job = value;
    } else if (arg === '--since' && (command === 'wait' || command === 'status')) {
      since = intArg('--since', rest[++i], 0, Number.MAX_SAFE_INTEGER);
    } else if (arg === '--timeout' && command === 'wait') {
      timeoutSec = intArg('--timeout', rest[++i], 0, MAX_WAIT_SEC);
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`อาร์กิวเมนต์ไม่รู้จักสำหรับ ${command}: ${arg}`);
    } else positional.push(arg);
  }
  const base = { projectDir: path.resolve(projectDir), ...(job === undefined ? {} : { job }) };
  if (command === 'answer') {
    if (positional.length !== 1) throw new Error('answer ต้องมีข้อความคำตอบ 1 ค่า (ครอบด้วยเครื่องหมายคำพูด)');
    return { command, ...base, text: positional[0]! };
  }
  if (positional.length > 0) throw new Error(`${command} ไม่รับค่า: ${positional.join(' ')}`);
  if (command === 'stop') return { command, ...base };
  return {
    command,
    ...base,
    ...(since === undefined ? {} : { since }),
    timeoutSec: command === 'status' ? 0 : (timeoutSec ?? DEFAULT_WAIT_SEC),
  };
}
