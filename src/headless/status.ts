import * as fs from 'node:fs';
import { JOB_ID_RE, type JobRepository } from '../jobs';
import type { Phase } from '../state';
import {
  headlessPath,
  readEvents,
  readJsonSafe,
  type Activity,
  type Answer,
  type ExitInfo,
  type ExitStatus,
  type Question,
} from './files';

export type JobStatus = 'question' | 'running' | ExitStatus | 'dead';

export interface StatusReport {
  jobId: string;
  status: JobStatus;
  phase: Phase;
  title?: string;
  /** agent ที่กำลังทำงานและ tool ล่าสุด (เฉพาะตอนรันอยู่) */
  activity?: Activity;
  /** คำถามที่รอคำตอบ (เฉพาะ status = question) */
  question?: Question;
  /** คำอธิบายสถานะจบ/ตาย เช่น error หรือวิธีทำต่อ */
  message?: string;
  /** ข้อความที่ agent-team แสดง (say) ตั้งแต่ since */
  messages: string[];
  /** ส่งค่านี้เป็น --since ครั้งถัดไป */
  lastSeq: number;
  /** ไม่ได้ส่ง since และมีข้อความเกิน DEFAULT_TAIL จึงตัดเหลือท้ายสุด */
  truncated?: boolean;
}

export const DEFAULT_TAIL = 20;

export async function readStatus(repo: JobRepository, jobId: string, since?: number): Promise<StatusReport> {
  const dir = repo.jobDir(jobId);
  const state = await repo.store(jobId).load();
  if (!state) throw new Error(`ไม่พบงาน ${jobId}`);
  const events = readEvents(dir, since ?? 0);
  const lastSeq = events.reduce((max, e) => Math.max(max, e.seq), since ?? 0);
  let messages = events.map((e) => e.text);
  const truncated = since === undefined && messages.length > DEFAULT_TAIL;
  if (truncated) messages = messages.slice(-DEFAULT_TAIL);

  const report: StatusReport = { jobId, status: 'running', phase: state.phase, messages, lastSeq };
  if (state.title) report.title = state.title;
  if (truncated) report.truncated = true;

  if (await repo.runningLock(jobId)) {
    const question = readJsonSafe<Question>(headlessPath(dir, 'question'));
    // นับว่าตอบแล้วเฉพาะ answer.json ที่อ่านได้และตรงคำถามนี้ (ไฟล์ค้างของคำถามก่อนต้องไม่บังคำถามใหม่)
    const answered = question !== undefined && readJsonSafe<Answer>(headlessPath(dir, 'answer'))?.questionId === question.id;
    if (question && !answered) {
      report.status = 'question';
      report.question = question;
    }
    const activity = readJsonSafe<Activity>(headlessPath(dir, 'activity'));
    if (activity) report.activity = activity;
    return report;
  }
  if (state.phase === 'DONE') {
    report.status = 'done';
    return report;
  }
  if (state.phase === 'ABORTED') {
    report.status = 'aborted';
    return report;
  }
  const exit = readJsonSafe<ExitInfo>(headlessPath(dir, 'exit'));
  if (exit) {
    report.status = exit.status;
    if (exit.message) report.message = exit.message;
    return report;
  }
  report.status = 'dead';
  report.message = `process ของงานนี้ไม่ได้รันอยู่ — ทำต่อด้วย agent-team run --headless --job ${jobId}`;
  return report;
}

export interface WaitOptions {
  since?: number;
  /** 0 = อ่านครั้งเดียว (คำสั่ง status) */
  timeoutMs: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** poll จนสถานะไม่ใช่ running (มีคำถาม/จบ/ตาย) หรือครบ timeout แล้วคืนสถานะล่าสุด */
export async function waitForStatus(repo: JobRepository, jobId: string, opts: WaitOptions): Promise<StatusReport> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = now() + opts.timeoutMs;
  for (;;) {
    const report = await readStatus(repo, jobId, opts.since);
    if (report.status !== 'running' || now() >= deadline) return report;
    await sleep(opts.pollMs ?? 1000);
  }
}

const isHeadlessJob = (repo: JobRepository, id: string): boolean =>
  fs.existsSync(headlessPath(repo.jobDir(id), 'events'));

/**
 * หา jobId ที่คำสั่ง headless จะทำงานด้วย
 * ไม่ระบุ job: งาน headless ที่รันอยู่งานเดียว; ถ้าไม่มีงานรันอยู่ runningOnly คืน undefined (ให้ wait รอต่อ)
 * ไม่งั้นใช้งาน headless ล่าสุด (ดูผลของงานที่จบแล้ว)
 */
export async function resolveJob(
  repo: JobRepository,
  job?: string,
  opts: { runningOnly?: boolean } = {},
): Promise<string | undefined> {
  if (job !== undefined) {
    if (!JOB_ID_RE.test(job)) throw new Error(`jobId ไม่ถูกรูปแบบ: ${job}`);
    if (!fs.existsSync(repo.jobDir(job))) throw new Error(`ไม่พบงาน ${job}`);
    return job;
  }
  const headless = (await repo.list()).filter((j) => isHeadlessJob(repo, j.id));
  const running = headless.filter((j) => j.lock);
  if (running.length === 1) return running[0]!.id;
  if (running.length > 1) {
    throw new Error(`มีงาน headless รันอยู่หลายงาน ระบุ --job: ${running.map((j) => j.id).join(', ')}`);
  }
  if (opts.runningOnly) return undefined;
  const latest = [...headless].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (!latest) throw new Error('ไม่พบงาน headless ในโปรเจกต์นี้ — เริ่มด้วย agent-team run --headless --request "..."');
  return latest.id;
}
