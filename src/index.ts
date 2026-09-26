import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from './args';
import { CliIO } from './cli';
import { loadConfig } from './config';
import { presentBillingVars } from './env';
import { makeInterruptHandler } from './interrupt';
import { selectJob } from './job-menu';
import { JobRepository } from './jobs';
import { FileLogger, LoggingIO } from './logger';
import { runTeam } from './orchestrator';
import { SdkRoleRunner } from './runner';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.projectDir) || !fs.statSync(args.projectDir).isDirectory()) {
    console.error(`ไม่พบโฟลเดอร์โปรเจกต์: ${args.projectDir} (สร้างโฟลเดอร์ก่อนแล้วรันใหม่)`);
    process.exit(1);
  }

  const config = loadConfig();
  const abortController = new AbortController();
  const logFile = path.join(args.projectDir, '.agent-team', 'agent-team.log');
  const logger = new FileLogger(logFile);
  const cli = new CliIO();
  const io = new LoggingIO(cli, logger);
  logger.log('INFO', 'run.start', {
    projectDir: args.projectDir,
    resume: args.resume,
    pid: process.pid,
    node: process.version,
    debug: process.env.AGENT_TEAM_DEBUG === '1',
  });
  io.say(`บันทึก log ที่ ${logFile}`);
  const ignored = presentBillingVars();
  if (ignored.length > 0) {
    io.say(`ไม่ส่ง ${ignored.join(', ')} ให้ agent — ใช้โควตา subscription ที่ login ไว้เท่านั้น`);
  }
  const runner = new SdkRoleRunner({
    projectDir: args.projectDir,
    config,
    abortController,
    logger,
    log: (line) => io.say(line),
    debug: process.env.AGENT_TEAM_DEBUG === '1',
  });
  const repo = new JobRepository(args.projectDir, { log: logger });
  let jobId: string | undefined;

  const onSignal = makeInterruptHandler({
    repo,
    getJobId: () => jobId,
    logger,
    abort: () => abortController.abort(),
    closeCli: () => cli.close(),
    print: (text) => console.log(text),
    exit: (code) => process.exit(code),
  });
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGHUP', () => onSignal('SIGHUP'));

  try {
    const job = await selectJob(repo, io, { resume: args.resume });
    jobId = job.id;
    logger.log('INFO', 'job.selected', { jobId, resume: args.resume });
    const final = await runTeam({ runner, io, store: job.store, config, log: logger });
    console.log(
      final.phase === 'DONE'
        ? '\nเสร็จสมบูรณ์'
        : `\nยกเลิกงานแล้ว (state ยังอยู่ใน .agent-team/jobs/${jobId}/)`,
    );
    logger.log('INFO', 'run.end', { phase: final.phase, jobId });
  } catch (e) {
    console.error(`\nหยุดเพราะ error: ${e instanceof Error ? e.message : String(e)}`);
    if (jobId) console.error('รันใหม่แล้วเลือกงานนี้จากเมนู หรือใช้ --resume เพื่อทำต่องานล่าสุด');
    logger.log('ERROR', 'run.error', {
      jobId,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    process.exitCode = 1;
  } finally {
    if (jobId) await repo.unlock(jobId);
    cli.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
