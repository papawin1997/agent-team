import * as path from 'node:path';
import type { StatusSink } from './activity';
import { loadConfig, type TeamConfig } from './config';
import type { UserIO } from './deps';
import { presentBillingVars } from './env';
import { JobRepository } from './jobs';
import { FileLogger } from './logger';
import { SdkRoleRunner } from './runner';
import { GitSnapshots, type SnapshotProvider } from './snapshot';
import { ensureTeamDir } from './team-dir';

export interface RunContext {
  config: TeamConfig;
  logger: FileLogger;
  logFile: string;
  abortController: AbortController;
  runner: SdkRoleRunner;
  repo: JobRepository;
  /** snapshot working tree ของโปรเจกต์ (ใช้หา diff รอบแก้ให้ QA) */
  snapshots: SnapshotProvider;
}

/** ของที่ทั้งโหมดโต้ตอบและ headless ต้องใช้ในการรันงาน (config, log, runner, repo) */
export function createRunContext(
  projectDir: string,
  opts: { say: (line: string) => void; status: StatusSink; headless?: boolean },
): RunContext {
  const config = loadConfig();
  const abortController = new AbortController();
  const logFile = path.join(ensureTeamDir(projectDir), 'agent-team.log');
  const logger = new FileLogger(logFile);
  const runner = new SdkRoleRunner({
    projectDir,
    config,
    abortController,
    logger,
    log: opts.say,
    status: opts.status,
    debug: process.env.AGENT_TEAM_DEBUG === '1',
  });
  const repo = new JobRepository(projectDir, { log: logger, headless: opts.headless });
  const snapshots = new GitSnapshots(projectDir);
  return { config, logger, logFile, abortController, runner, repo, snapshots };
}

/** log run.start และแจ้งที่อยู่ log / env ที่ไม่ส่งให้ agent */
export function announceRun(ctx: RunContext, io: UserIO, data: Record<string, unknown>): void {
  ctx.logger.log('INFO', 'run.start', {
    ...data,
    pid: process.pid,
    node: process.version,
    debug: process.env.AGENT_TEAM_DEBUG === '1',
  });
  io.say(`บันทึก log ที่ ${ctx.logFile}`);
  const ignored = presentBillingVars();
  if (ignored.length > 0) {
    io.say(`ไม่ส่ง ${ignored.join(', ')} ให้ agent — ใช้โควตา subscription ที่ login ไว้เท่านั้น`);
  }
}
