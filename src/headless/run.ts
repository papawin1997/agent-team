import * as fs from 'node:fs';
import type { CliArgs } from '../args';
import type { TeamConfig } from '../config';
import type { RoleRunner, StateStore, UserIO } from '../deps';
import type { SnapshotProvider } from '../snapshot';
import { makeInterruptHandler, type InterruptSignal } from '../interrupt';
import { selectJob, type SelectedJob } from '../job-menu';
import type { JobRepository } from '../jobs';
import { LoggingIO, type Logger } from '../logger';
import { runTeam } from '../orchestrator';
import { ProjectRegistry, teamRootError } from '../projects';
import { announceRun, createRunContext } from '../run-context';
import type { Level } from '../schemas';
import { headlessPath, removeQuietly, writeExit, type ExitStatus } from './files';
import { ActivityStatus, HeadlessIdleError, HeadlessIO } from './io';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** io สำหรับ selectJob --resume: เส้นทางนี้ไม่ควรถามอะไร ถ้าถูกถามแปลว่ามีทางที่ต้องใช้คนตัดสิน → ล้มชัด ๆ */
const noAskIO: UserIO = {
  say() {},
  ask: async () => {
    throw new Error('headless: เลือกงานต้องถามผู้ใช้ — ระบุ --job <id> แทน');
  },
  choose: async () => {
    throw new Error('headless: เลือกงานต้องถามผู้ใช้ — ระบุ --job <id> แทน');
  },
  chooseOrText: async () => {
    throw new Error('headless: เลือกงานต้องถามผู้ใช้ — ระบุ --job <id> แทน');
  },
};

/** เลือก/สร้างงานสำหรับโหมด headless งานที่คืนออกมาถูก lock แล้วเสมอ */
export async function startHeadlessJob(
  repo: JobRepository,
  opts: { request?: string; resume: boolean; job?: string },
): Promise<SelectedJob> {
  await repo.migrateLegacy();
  if (opts.job !== undefined) {
    if (!(await repo.store(opts.job).load())) throw new Error(`ไม่พบงาน ${opts.job}`);
    if (!(await repo.lock(opts.job))) throw new Error(`งาน ${opts.job} กำลังรันอยู่ใน process อื่น`);
    return { id: opts.job, store: repo.store(opts.job) };
  }
  if (opts.resume) return selectJob(repo, noAskIO, { resume: true });
  const running = (await repo.list()).filter((j) => j.lock);
  if (running.length > 0) {
    throw new Error(
      `มีงานกำลังรันอยู่ในโปรเจกต์นี้ (${running.map((j) => j.id).join(', ')}) — headless ไม่เริ่มงานซ้อน`,
    );
  }
  const job = await repo.create();
  const state = await job.store.load();
  if (!state) throw new Error(`สร้างงาน ${job.id} ไม่สำเร็จ`);
  state.pendingPrompt = opts.request;
  await job.store.save(state);
  return job;
}

export interface HeadlessJobOptions {
  repo: JobRepository;
  jobId: string;
  store: StateStore;
  runner: RoleRunner;
  config: TeamConfig;
  logger: Logger;
  /** LoggingIO ที่ครอบ HeadlessIO ของงานนี้ */
  io: UserIO;
  levelPreference?: Level;
  /** เรียกหลังเขียน exit.json เมื่อเจอ stop.json (runHeadless ส่ง interrupt handler ที่จบด้วย exit 130) */
  onStop: () => void;
  stopPollMs?: number;
  /** ส่งต่อเข้า Deps.snapshots (ไม่มี = QA ตรวจทั้ง task ทุกรอบ) */
  snapshots?: SnapshotProvider;
  /** ส่งต่อเข้า Deps.abortSignal (ctx.abortController.signal) */
  abortSignal?: AbortSignal;
}

/** รัน orchestrator กับงานที่ lock แล้ว เขียน exit.json ตอนจบทุกทาง และปล่อย lock */
export async function runHeadlessJob(o: HeadlessJobOptions): Promise<ExitStatus> {
  const dir = o.repo.jobDir(o.jobId);
  const stopFile = headlessPath(dir, 'stop');
  removeQuietly(headlessPath(dir, 'exit'));
  removeQuietly(stopFile);
  const timer = setInterval(() => {
    if (!fs.existsSync(stopFile)) return;
    clearInterval(timer);
    removeQuietly(stopFile);
    writeExit(dir, 'stopped', 'หยุดตามคำสั่ง agent-team stop');
    o.onStop();
  }, o.stopPollMs ?? 1000);
  try {
    const final = await runTeam({
      runner: o.runner,
      io: o.io,
      store: o.store,
      config: o.config,
      log: o.logger,
      levelPreference: o.levelPreference,
      snapshots: o.snapshots,
      abortSignal: o.abortSignal,
    });
    const status: ExitStatus = final.phase === 'DONE' ? 'done' : 'aborted';
    writeExit(dir, status);
    o.logger.log('INFO', 'run.end', { phase: final.phase, jobId: o.jobId, headless: true });
    return status;
  } catch (e) {
    const status: ExitStatus = e instanceof HeadlessIdleError ? 'idle' : 'error';
    const message = `${errMessage(e)} — ทำต่อด้วย agent-team run --headless --job ${o.jobId}`;
    writeExit(dir, status, message);
    o.logger.log(status === 'idle' ? 'WARN' : 'ERROR', 'run.error', {
      jobId: o.jobId,
      headless: true,
      message,
      stack: e instanceof Error ? e.stack : undefined,
    });
    return status;
  } finally {
    clearInterval(timer);
    await o.repo.unlock(o.jobId);
  }
}

/** agent-team run --headless: ไม่มีเมนู ไม่สร้าง CliIO stdout เป็นบรรทัด JSON เท่านั้น คืน exit code */
export async function runHeadless(args: CliArgs): Promise<number> {
  const projectDir = args.projectDir!;
  const rootError = teamRootError(projectDir);
  if (rootError) {
    console.error(rootError);
    return 1;
  }
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    console.error(`ไม่พบโฟลเดอร์โปรเจกต์: ${projectDir}`);
    return 1;
  }
  await new ProjectRegistry(undefined, { warn: () => {} }).touch(projectDir).catch(() => {});

  const activity = new ActivityStatus();
  let io: UserIO | undefined;
  const ctx = createRunContext(projectDir, { say: (line) => io?.say(line), status: activity, headless: true });
  let job: SelectedJob;
  try {
    job = await startHeadlessJob(ctx.repo, { request: args.request, resume: args.resume, job: args.job });
  } catch (e) {
    console.error(errMessage(e));
    return 1;
  }
  const dir = ctx.repo.jobDir(job.id);
  activity.attach(dir);
  const headless = new HeadlessIO({ dir, idleTimeoutMs: ctx.config.headlessIdleMinutes * 60_000 });
  io = new LoggingIO(headless, ctx.logger);
  console.log(JSON.stringify({ jobId: job.id, since: headless.lastSeq, projectDir }));
  announceRun(ctx, io, { projectDir, resume: args.resume, headless: true, jobId: job.id });

  const onSignal = makeInterruptHandler({
    repo: ctx.repo,
    getJobId: () => job.id,
    logger: ctx.logger,
    abort: () => ctx.abortController.abort(),
    closeCli: () => {},
    print: (text) => console.error(text.trim()),
    exit: (code) => process.exit(code),
  });
  const stopBySignal = (signal: InterruptSignal): void => {
    writeExit(dir, 'stopped', `หยุดด้วย ${signal}`);
    onSignal(signal);
  };
  for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM'] as const) process.on(signal, () => stopBySignal(signal));

  const status = await runHeadlessJob({
    repo: ctx.repo,
    jobId: job.id,
    store: job.store,
    runner: ctx.runner,
    config: ctx.config,
    logger: ctx.logger,
    io,
    levelPreference: args.level,
    onStop: () => onSignal('stop'),
    snapshots: ctx.snapshots,
    abortSignal: ctx.abortController.signal,
  });
  console.log(JSON.stringify({ jobId: job.id, status }));
  return status === 'error' || status === 'idle' ? 1 : 0;
}
