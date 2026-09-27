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

interface ParsedEntry {
  timestamp: string;
  entry: Json;
}

/** หนึ่ง entry ของ transcript ที่แปลงเป็น step (ตัดความยาวแล้ว) พร้อมเวลาของมัน เก็บเฉพาะ entry ที่ให้ step จริง */
interface ClippedEntry {
  t: number;
  steps: TranscriptStep[];
}

/** ผลของการพาร์ส+แปลงไฟล์ transcript หนึ่งไฟล์ ไม่เก็บ entry ดิบ (JSON เต็มของ prompt/ผล tool) ไว้เลย */
interface ParsedFile {
  /** เวลาของ entry แรกที่มี timestamp (ใช้กับ findByTime) */
  firstTimestamp?: number;
  /** entry แรกมี entrypoint 'sdk-ts' หรือไม่ (ไฟล์จาก Agent SDK จริง ไม่ใช่ session แบบโต้ตอบที่ผู้ใช้เปิด claude เอง) */
  isSdk: boolean;
  clipped: ClippedEntry[];
}

/**
 * cache ของไฟล์ transcript ที่พาร์ส+แปลงแล้ว คีย์ด้วย path ไฟล์ ตรวจว่ายังไม่เปลี่ยนด้วย size+mtimeMs
 * ใช้ตอน --live เพื่อไม่ต้องอ่าน/พาร์สไฟล์เดิมซ้ำทุกครั้งที่ /data ถูก poll (ทุก 3 วินาที)
 * เก็บเฉพาะ step ที่ตัดความยาวแล้วต่อ timestamp ไม่เก็บ entry ดิบ (prompt/ผล tool เต็ม ๆ) ไว้ตลอดอายุ server
 */
export type TranscriptCache = Map<string, ParsedFile & { size: number; mtimeMs: number }>;

export function createTranscriptCache(): TranscriptCache {
  return new Map();
}

function parseJsonl(jsonl: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (isObj(entry) && typeof entry.timestamp === 'string') entries.push({ timestamp: entry.timestamp, entry });
  }
  return entries;
}

/** พาร์ส jsonl แล้วแปลงเป็น step ทันที (ตัดความยาวแล้ว) เพื่อไม่ต้องเก็บ entry ดิบต่อ */
function parseAndClip(jsonl: string): ParsedFile {
  const entries = parseJsonl(jsonl);
  let firstTimestamp: number | undefined;
  let isSdk = false;
  const clipped: ClippedEntry[] = [];
  for (const { timestamp, entry } of entries) {
    const t = Date.parse(timestamp);
    if (firstTimestamp === undefined) {
      firstTimestamp = t;
      isSdk = entry.entrypoint === 'sdk-ts';
    }
    const steps = toSteps(entry, timestamp);
    if (steps.length) clipped.push({ t, steps });
  }
  return { firstTimestamp, isSdk, clipped };
}

/** อ่าน+พาร์ส+แปลงไฟล์ (ใช้ cache ถ้ามีและไฟล์ไม่เปลี่ยน) */
function loadFile(file: string, cache?: TranscriptCache): ParsedFile {
  if (cache) {
    const st = fs.statSync(file);
    const hit = cache.get(file);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit;
    const parsed = parseAndClip(fs.readFileSync(file, 'utf8'));
    const cached = { size: st.size, mtimeMs: st.mtimeMs, ...parsed };
    cache.set(file, cached);
    return cached;
  }
  return parseAndClip(fs.readFileSync(file, 'utf8'));
}

function sliceClipped(clipped: ClippedEntry[], from: string, to?: string): TranscriptStep[] {
  const [lo, hi] = windowOf(from, to);
  const steps: TranscriptStep[] = [];
  for (const { t, steps: s } of clipped) {
    if (t >= lo && t <= hi) steps.push(...s);
  }
  return steps;
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
  return sliceClipped(parseAndClip(jsonl).clipped, from, to);
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

export interface LoadCallTranscriptOpts {
  /** ชื่อไฟล์ (basename) ที่ call อื่นในรอบเดียวกันมี sessionId ชี้อยู่แล้ว: กัน findByTime แย่งไฟล์นั้นไป */
  exclude?: ReadonlySet<string>;
  cache?: TranscriptCache;
}

export function loadCallTranscript(dir: string, call: AgentCall, opts: LoadCallTranscriptOpts = {}): CallTranscript {
  const file = call.sessionId ? path.join(dir, `${call.sessionId}.jsonl`) : findByTime(dir, call, opts);
  if (!file || !fs.existsSync(file)) {
    return {
      steps: [],
      note: call.sessionId
        ? `ไม่พบ transcript ${call.sessionId}.jsonl ใน ${dir}`
        : `ไม่พบ transcript ของช่วงเวลานี้ใน ${dir}`,
    };
  }
  try {
    return { file, steps: sliceClipped(loadFile(file, opts.cache).clipped, call.start, call.end) };
  } catch (e) {
    return { file, steps: [], note: `อ่าน transcript ไม่ได้: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * ไม่มี sessionId (เช่น process ล่มก่อนได้ result): หาไฟล์ที่ entry แรกอยู่ในช่วงเวลาของ call
 * ข้ามไฟล์ที่ถูก exclude ไว้ (call อื่นในรอบเดียวกันจับไปแล้วด้วย sessionId) แล้วเลือกไฟล์ที่ entry แรกใกล้ call.start ที่สุด
 * (ไม่ใช่ไฟล์แรกที่เจอใน readdir ซึ่งไม่มีลำดับที่รับประกัน)
 */
function findByTime(dir: string, call: AgentCall, opts: LoadCallTranscriptOpts): string | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return undefined;
  }
  const [lo, hi] = windowOf(call.start, call.end);
  const startMs = Date.parse(call.start);
  let best: { file: string; diff: number } | undefined;
  for (const name of names) {
    if (opts.exclude?.has(name)) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < lo) continue;
      const parsed = loadFile(file, opts.cache);
      const first = parsed.firstTimestamp;
      if (first === undefined || !(first >= lo && first <= hi)) continue;
      // กัน session Claude Code แบบโต้ตอบที่ผู้ใช้เปิดเองในโฟลเดอร์เดียวกัน (entrypoint ไม่ใช่ sdk-ts)
      if (!parsed.isSdk) continue;
      const diff = Math.abs(first - startMs);
      if (!best || diff < best.diff) best = { file, diff };
    } catch {
      continue;
    }
  }
  return best?.file;
}
