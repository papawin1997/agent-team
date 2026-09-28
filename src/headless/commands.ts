import * as fs from 'node:fs';
import { parseChoice } from '../cli';
import { installSkill } from '../install-skill';
import { JobRepository } from '../jobs';
import type { HeadlessCommand } from './args';
import { headlessPath, readJsonSafe, removeQuietly, writeExit, writeJsonAtomic, type Answer, type Question } from './files';
import { resolveJob, waitForStatus } from './status';

export interface CommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface CommandDeps {
  sleep?: (ms: number) => Promise<void>;
  kill?: (pid: number) => void;
  /** stop: รอให้ process หยุดเองนานสุดเท่านี้ก่อน kill */
  stopGraceMs?: number;
  pollMs?: number;
  home?: string;
  skillSource?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const json = (data: unknown): string => JSON.stringify(data, null, 2);
const fail = (message: string): CommandResult => ({ exitCode: 1, stderr: message });

/** คำสั่งสั้น ๆ ของ headless: อ่าน/เขียนไฟล์ในโฟลเดอร์งาน ไม่เรียกโมเดล */
export async function runHeadlessCommand(cmd: HeadlessCommand, deps: CommandDeps = {}): Promise<CommandResult> {
  try {
    if (cmd.command === 'install-skill') {
      const target = installSkill({ home: deps.home, source: deps.skillSource });
      return { exitCode: 0, stdout: `ติดตั้ง skill แล้วที่ ${target}` };
    }
    const repo = new JobRepository(cmd.projectDir);
    const sleep = deps.sleep ?? defaultSleep;
    if (cmd.command === 'wait' || cmd.command === 'status') {
      const deadline = Date.now() + cmd.timeoutSec * 1000;
      let jobId = await resolveJob(repo, cmd.job, { runningOnly: cmd.command === 'wait' });
      // wait ไม่ระบุ job: process ใน background อาจยังสร้างงานไม่เสร็จ รอจนเจอ (ห้ามหยิบงานเก่าที่จบแล้ว)
      while (jobId === undefined && Date.now() < deadline) {
        await sleep(deps.pollMs ?? 1000);
        jobId = await resolveJob(repo, undefined, { runningOnly: true });
      }
      if (jobId === undefined) return fail('ไม่พบงาน headless ที่กำลังรัน — ระบุ --job หรือเริ่มด้วย agent-team run --headless');
      const report = await waitForStatus(repo, jobId, {
        since: cmd.since,
        timeoutMs: Math.max(0, deadline - Date.now()),
        pollMs: deps.pollMs,
        sleep,
      });
      return { exitCode: 0, stdout: json(report) };
    }
    const jobId = (await resolveJob(repo, cmd.job))!;
    if (cmd.command === 'answer') return await answer(repo, jobId, cmd.text);
    return await stop(repo, jobId, { ...deps, sleep });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

async function answer(repo: JobRepository, jobId: string, text: string): Promise<CommandResult> {
  const dir = repo.jobDir(jobId);
  if (!(await repo.runningLock(jobId))) {
    return fail(`งาน ${jobId} ไม่ได้รันอยู่ — ทำต่อด้วย agent-team run --headless --job ${jobId}`);
  }
  const question = readJsonSafe<Question>(headlessPath(dir, 'question'));
  if (!question) return fail(`งาน ${jobId} ไม่มีคำถามรอคำตอบอยู่ — ดูสถานะด้วย agent-team status --job ${jobId}`);
  // answer.json ของคำถามก่อนที่ลบไม่สำเร็จ (id ไม่ตรง/พัง) เขียนทับได้ ปฏิเสธเฉพาะคำตอบของคำถามนี้ที่ยังไม่ถูกอ่าน
  if (readJsonSafe<Answer>(headlessPath(dir, 'answer'))?.questionId === question.id) {
    return fail('มีคำตอบที่ส่งไปแล้วรอ process อ่านอยู่ — เรียก wait เพื่อดูสถานะล่าสุด');
  }
  const options = question.options ?? [];
  if (question.kind === 'choice' && !parseChoice(text, options)) {
    return fail(`ต้องตอบเป็นหนึ่งใน: ${options.join(', ')}`);
  }
  writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: question.id, text });
  return { exitCode: 0, stdout: json({ ok: true, jobId, questionId: question.id }) };
}

async function stop(
  repo: JobRepository,
  jobId: string,
  deps: CommandDeps & { sleep: (ms: number) => Promise<void> },
): Promise<CommandResult> {
  const dir = repo.jobDir(jobId);
  if (!fs.existsSync(headlessPath(dir, 'events'))) {
    return fail(`งาน ${jobId} ไม่ใช่งาน headless — หยุดงานที่รันใน terminal ด้วย Ctrl+C`);
  }
  const lock = await repo.runningLock(jobId);
  if (!lock) return { exitCode: 0, stdout: json({ ok: true, jobId, stopped: false, message: 'งานนี้ไม่ได้รันอยู่' }) };
  const pollMs = deps.pollMs ?? 500;
  const graceMs = deps.stopGraceMs ?? 10_000;
  writeJsonAtomic(headlessPath(dir, 'stop'), { at: new Date().toISOString() });
  for (let waited = 0; waited < graceMs; waited += pollMs) {
    await deps.sleep(pollMs);
    if (!(await repo.runningLock(jobId))) return { exitCode: 0, stdout: json({ ok: true, jobId, stopped: true }) };
  }
  // process ไม่ตอบสนอง (เช่น node ลูกค้างหลัง shim ถูก kill บน Windows): kill ตรง pid ที่ถือ lock แล้วเก็บกวาดแทน
  try {
    (deps.kill ?? ((pid: number) => void process.kill(pid)))(lock.pid);
  } catch {
    // ตายไปแล้วระหว่างรอ
  }
  removeQuietly(repo.lockPath(jobId));
  removeQuietly(headlessPath(dir, 'stop'));
  removeQuietly(headlessPath(dir, 'question'));
  writeExit(dir, 'stopped', 'ถูก kill เพราะไม่หยุดเองภายในเวลาที่กำหนด');
  return { exitCode: 0, stdout: json({ ok: true, jobId, stopped: true, killed: true }) };
}
