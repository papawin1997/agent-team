import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config';
import { headlessPath, readEvents, readJsonSafe, writeJsonAtomic, type ExitInfo, type Question } from '../../src/headless/files';
import { HeadlessIO } from '../../src/headless/io';
import { runHeadlessJob, startHeadlessJob } from '../../src/headless/run';
import { JobRepository } from '../../src/jobs';
import { nullLogger } from '../../src/logger';
import { asking, makeDesign, passReport, proposal } from '../helpers/builders';
import { FakeRunner, type FakeScript } from '../helpers/fakes';
import { until } from '../helpers/until';

let projectDir: string;
beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-hrun-'));
});

/** ตอบคำถามตามลำดับ (รอคำถามที่ id ใหม่ทุกครั้ง) คืน prompt ที่เจอ */
async function answerAll(dir: string, answers: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const text of answers) {
    const q = await until(() => {
      const current = readJsonSafe<Question>(headlessPath(dir, 'question'));
      return current && !seen.has(current.id) ? current : undefined;
    });
    seen.add(q.id);
    prompts.push(q.prompt);
    writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: q.id, text });
  }
  return prompts;
}

async function setup(script: FakeScript, idleTimeoutMs = 3000) {
  const repo = new JobRepository(projectDir);
  const job = await startHeadlessJob(repo, { request: 'อยากได้ todo', resume: false });
  const dir = repo.jobDir(job.id);
  const io = new HeadlessIO({ dir, idleTimeoutMs, pollMs: 5 });
  const runner = new FakeRunner(script);
  const stops: number[] = [];
  const run = (stopPollMs = 1000) =>
    runHeadlessJob({
      repo,
      jobId: job.id,
      store: job.store,
      runner,
      config: DEFAULT_CONFIG,
      logger: nullLogger,
      io,
      onStop: () => void stops.push(Date.now()),
      stopPollMs,
    });
  return { repo, job, dir, runner, run, stops };
}

describe('startHeadlessJob', () => {
  it('งานใหม่: ตั้ง pendingPrompt จาก --request และถือ lock', async () => {
    const repo = new JobRepository(projectDir);
    const job = await startHeadlessJob(repo, { request: 'อยากได้ todo', resume: false });
    expect((await job.store.load())?.pendingPrompt).toBe('อยากได้ todo');
    expect(await repo.runningLock(job.id)).toBeDefined();
  });

  it('งานใหม่แต่มีงานอื่นรันอยู่ → throw ไม่เริ่มงานซ้อน', async () => {
    const repo = new JobRepository(projectDir);
    await startHeadlessJob(repo, { request: 'a', resume: false });
    await expect(startHeadlessJob(repo, { request: 'b', resume: false })).rejects.toThrow('ไม่เริ่มงานซ้อน');
  });

  it('--job: lock งานที่ระบุ; งานที่ไม่มี → throw', async () => {
    const repo = new JobRepository(projectDir);
    const first = await startHeadlessJob(repo, { request: 'a', resume: false });
    await repo.unlock(first.id);
    const again = await startHeadlessJob(repo, { job: first.id, resume: false });
    expect(again.id).toBe(first.id);
    await expect(startHeadlessJob(repo, { job: '20200101-000000', resume: false })).rejects.toThrow('ไม่พบงาน');
  });

  it('--resume: ทำต่องานค้างล่าสุดโดยไม่ถามอะไร', async () => {
    const repo = new JobRepository(projectDir);
    const first = await startHeadlessJob(repo, { request: 'a', resume: false });
    const store = repo.store(first.id);
    const state = (await store.load())!;
    state.title = 'a';
    await store.save(state);
    await repo.unlock(first.id);
    expect((await startHeadlessJob(repo, { resume: true })).id).toBe(first.id);
  });
});

describe('runHeadlessJob', () => {
  it('flow เต็มผ่านไฟล์คำถาม/คำตอบ → done, exit.json done, ปล่อย lock', async () => {
    const { repo, job, dir, run } = await setup({
      pm: [proposal(), asking('สรุป design'), asking('สรุปส่งมอบ')],
      plans: [makeDesign()],
      qa: [passReport('api'), passReport('ui')],
    });
    const result = run();
    const prompts = await answerAll(dir, ['confirm', 'confirm', 'accept']);
    await expect(result).resolves.toBe('done');
    expect(prompts).toHaveLength(3);
    expect(readJsonSafe<ExitInfo>(headlessPath(dir, 'exit'))?.status).toBe('done');
    expect(await repo.runningLock(job.id)).toBeUndefined();
    expect(readEvents(dir).length).toBeGreaterThan(0);
  });

  it('ไม่มีใครตอบจนเกิน idle timeout → idle พร้อมวิธีทำต่อ', async () => {
    const { job, dir, run } = await setup({ pm: [asking('ขอรายละเอียดเพิ่ม')] }, 50);
    await expect(run()).resolves.toBe('idle');
    const exit = readJsonSafe<ExitInfo>(headlessPath(dir, 'exit'));
    expect(exit?.status).toBe('idle');
    expect(exit?.message).toContain(`--job ${job.id}`);
  });

  it('เจอ stop.json → เขียน exit.json stopped แล้วเรียก onStop ครั้งเดียว', async () => {
    const { dir, run, stops } = await setup({ pm: [asking('ขอรายละเอียดเพิ่ม')] }, 300);
    const result = run(5);
    await until(() => readJsonSafe<Question>(headlessPath(dir, 'question')));
    writeJsonAtomic(headlessPath(dir, 'stop'), { at: 't' });
    await until(() => (stops.length > 0 ? true : undefined));
    expect(readJsonSafe<ExitInfo>(headlessPath(dir, 'exit'))?.status).toBe('stopped');
    expect(fs.existsSync(headlessPath(dir, 'stop'))).toBe(false);
    await result; // ในเทสต์ onStop ไม่ exit จริง งานจึงจบด้วย idle ตามมา
    expect(stops).toHaveLength(1);
  });

  it('ลบ exit.json/stop.json ค้างจากรอบก่อนตอนเริ่ม', async () => {
    const { dir, run } = await setup({ pm: [asking('?')] }, 30);
    writeJsonAtomic(headlessPath(dir, 'stop'), { at: 'old' });
    writeJsonAtomic(headlessPath(dir, 'exit'), { status: 'error', at: 'old' });
    await expect(run(1000)).resolves.toBe('idle');
  });
});
