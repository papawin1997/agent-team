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
import { selectProject } from './project-menu';
import { ProjectRegistry, teamRootError } from './projects';
import { SdkRoleRunner } from './runner';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cli = new CliIO();
  // CliIO ส่ง Ctrl+C ต่อเป็น process 'SIGINT' แต่ handler หลักยังไม่ถูกตั้งตอนอยู่ในเมนูโปรเจกต์
  const quitBeforeStart = (): void => {
    cli.close();
    process.exit(130);
  };
  process.on('SIGINT', quitBeforeStart);
  const registry = new ProjectRegistry(undefined, { warn: (m) => cli.say(m) });
  const projectDir = args.projectDir ?? (await selectProject({ registry, io: cli }));
  if (!projectDir) {
    cli.close();
    return;
  }
  const rootError = teamRootError(projectDir);
  if (rootError) {
    console.error(rootError);
    cli.close();
    process.exit(1);
  }
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    console.error(`ไม่พบโฟลเดอร์โปรเจกต์: ${projectDir} (สร้างโฟลเดอร์ก่อน หรือรัน agent-team แล้วกด n เพื่อสร้าง)`);
    cli.close();
    process.exit(1);
  }
  try {
    await registry.touch(projectDir);
  } catch (e) {
    cli.say(`บันทึกรายชื่อโปรเจกต์ไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — ทำงานต่อได้ตามปกติ`);
  }
  process.off('SIGINT', quitBeforeStart);

  const config = loadConfig();
  const abortController = new AbortController();
  const logFile = path.join(projectDir, '.agent-team', 'agent-team.log');
  const logger = new FileLogger(logFile);
  const io = new LoggingIO(cli, logger);
  logger.log('INFO', 'run.start', {
    projectDir,
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
    projectDir,
    config,
    abortController,
    logger,
    log: (line) => io.say(line),
    status: cli.status,
    debug: process.env.AGENT_TEAM_DEBUG === '1',
  });
  const repo = new JobRepository(projectDir, { log: logger });
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
