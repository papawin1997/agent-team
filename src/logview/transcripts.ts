import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentCall } from './parse-log';

/** ความยาวสูงสุดของแต่ละชิ้นใน transcript ที่แสดง (ไม่แสดง prompt/ผลเต็ม) */
export const MAX_STEP_CHARS = 2000;
/** เผื่อเวลาเหลื่อมระหว่าง log ของ agent-team กับ transcript ของ SDK */
const WINDOW_SLACK_MS = 2000;

export type TranscriptStep =
  | { kind: 'text'; time: string; text: string }
  | { kind: 'tool_use'; time: string; name: string; input: string }
  | { kind: 'tool_result'; time: string; isError: boolean; text: string }
  | { kind: 'api_error'; time: string; status?: number; message: string; networkDown: boolean };

export interface CallTranscript {
  /** ไฟล์ที่อ่าน (ถ้าเจอ) */
  file?: string;
  steps: TranscriptStep[];
  /** เหตุผลที่ไม่มีข้อมูล เช่นหาไฟล์ไม่เจอ */
  note?: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

export function clip(text: string, max: number = MAX_STEP_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…(ตัด ${text.length - max} ตัวอักษร)` : text;
}

/** โฟลเดอร์ที่ Claude Agent SDK เก็บ transcript ของโปรเจกต์นี้ */
export function transcriptsDir(
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const base = env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  return path.join(base, 'projects', projectDir.replace(/[^a-zA-Z0-9]/g, '-'));
}

const windowOf = (from: string, to?: string): [number, number] => [
  Date.parse(from) - WINDOW_SLACK_MS,
  to ? Date.parse(to) + WINDOW_SLACK_MS : Number.POSITIVE_INFINITY,
];

/** แปลง transcript (jsonl) เป็น step เฉพาะ entry ที่เวลาอยู่ในช่วง from..to */
export function sliceTranscript(jsonl: string, from: string, to?: string): TranscriptStep[] {
  const [lo, hi] = windowOf(from, to);
  const steps: TranscriptStep[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObj(entry) || typeof entry.timestamp !== 'string') continue;
    const t = Date.parse(entry.timestamp);
    if (!(t >= lo && t <= hi)) continue;
    steps.push(...toSteps(entry, entry.timestamp));
  }
  return steps;
}

function toSteps(entry: Json, time: string): TranscriptStep[] {
  if (entry.type === 'system' && entry.subtype === 'api_error') {
    const err = isObj(entry.error) ? entry.error : {};
    return [
      {
        kind: 'api_error',
        time,
        status: typeof err.status === 'number' ? err.status : undefined,
        message: clip(String(err.formatted ?? err.message ?? 'API error')),
        networkDown: err.isNetworkDown === true || isObj(err.connection),
      },
    ];
  }
  const message = isObj(entry.message) ? entry.message : undefined;
  if (!message || !Array.isArray(message.content)) return [];
  const steps: TranscriptStep[] = [];
  for (const block of message.content) {
    if (!isObj(block)) continue;
    if (entry.type === 'assistant' && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      steps.push({ kind: 'text', time, text: clip(block.text) });
    } else if (entry.type === 'assistant' && block.type === 'tool_use') {
      steps.push({
        kind: 'tool_use',
        time,
        name: String(block.name ?? '?'),
        input: clip(JSON.stringify(block.input ?? {})),
      });
    } else if (entry.type === 'user' && block.type === 'tool_result') {
      steps.push({ kind: 'tool_result', time, isError: block.is_error === true, text: clip(resultText(block.content)) });
    }
  }
  return steps;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function loadCallTranscript(dir: string, call: AgentCall): CallTranscript {
  const file = call.sessionId ? path.join(dir, `${call.sessionId}.jsonl`) : findByTime(dir, call);
  if (!file || !fs.existsSync(file)) {
    return {
      steps: [],
      note: call.sessionId
        ? `ไม่พบ transcript ${call.sessionId}.jsonl ใน ${dir}`
        : `ไม่พบ transcript ของช่วงเวลานี้ใน ${dir}`,
    };
  }
  try {
    return { file, steps: sliceTranscript(fs.readFileSync(file, 'utf8'), call.start, call.end) };
  } catch (e) {
    return { file, steps: [], note: `อ่าน transcript ไม่ได้: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** ไม่มี sessionId (เช่น process ล่มก่อนได้ result): หาไฟล์ที่ entry แรกที่มีเวลาอยู่ในช่วงของ call */
function findByTime(dir: string, call: AgentCall): string | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return undefined;
  }
  const [lo, hi] = windowOf(call.start, call.end);
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < lo) continue;
      const first = firstTimestamp(fs.readFileSync(file, 'utf8'));
      if (first !== undefined && first >= lo && first <= hi) return file;
    } catch {
      continue;
    }
  }
  return undefined;
}

function firstTimestamp(jsonl: string): number | undefined {
  for (const line of jsonl.split(/\r?\n/)) {
    try {
      const entry: unknown = JSON.parse(line);
      if (isObj(entry) && typeof entry.timestamp === 'string') return Date.parse(entry.timestamp);
    } catch {
      // ข้ามบรรทัดพัง
    }
  }
  return undefined;
}
