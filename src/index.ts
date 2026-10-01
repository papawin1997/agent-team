import * as fs from 'node:fs';
import { parseArgs } from './args';
import { HandoffStore } from './ask/handoff-store';
import { askJobPrompt, runAsk } from './ask/session';
import { CliIO } from './cli';
import { isHeadlessCommand, parseHeadlessCommand } from './headless/args';
import { runHeadlessCommand } from './headless/commands';
import { runHeadless } from './headless/run';
import { makeInterruptHandler } from './interrupt';
import { createJobWithPrompt, selectJob, type SelectedJob } from './job-menu';
import { LoggingIO } from './logger';
import { runLogsCommand } from './logview/command';
import { runTeam } from './orchestrator';
import { selectProject } from './project-menu';
import { ProjectRegistry, teamRootError } from './projects';
import { announceRun, createRunContext } from './run-context';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // คำสั่งสั้นของ headless: ไม่มีเมนู ไม่สร้าง CliIO (stdin ของ task เบื้องหลังมักปิดอยู่)
  if (isHeadlessCommand(argv[0])) {
    const result = await runHeadlessCommand(parseHeadlessCommand(argv));
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exitCode = result.exitCode;
    return;
  }
  const args = parseArgs(argv);
  if (args.headless) {
    process.exitCode = await runHeadless(args);
    return;
  }
  const cli = new CliIO();
  // CliIO ส่ง Ctrl+C ต่อเป็น process 'SIGINT' แต่ handler หลักยังไม่ถูกตั้งตอนอยู่ในเมนูโปรเจกต์
  const quitBeforeStart = (): void => {
    cli.close();
    process.exit(130);
  };
  process.on('SIGINT', quitBeforeStart);
  const isLogs = args.command === 'logs';
  const registry = new ProjectRegistry(undefined, { warn: (m) => cli.say(m, 'warn') });
  const projectDir = args.projectDir ?? (await selectProject({ registry, io: cli, allowNew: !isLogs }));
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
  // agent-team logs แค่ดู log ไม่ควรทำให้โปรเจกต์นี้ขึ้นไปอยู่บนสุดของเมนู (เหมือนเปิดโปรเจกต์จริง)
  if (!isLogs) {
    try {
      await registry.touch(projectDir);
    } catch (e) {
      cli.say(`บันทึกรายชื่อโปรเจกต์ไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — ทำงานต่อได้ตามปกติ`, 'warn');
    }
  }
  process.off('SIGINT', quitBeforeStart);
  if (args.command === 'logs') {
    cli.close();
    const server = await runLogsCommand(projectDir, args.live, { say: (text) => console.log(text) });
    if (server) {
      process.on('SIGINT', () => {
        void server.close().then(() => process.exit(0));
      });
    }
    return;
  }

  let io: LoggingIO | undefined;
  const ctx = createRunContext(projectDir, { say: (line, kind) => io?.say(line, kind), status: cli.status });
  const loggingIO = new LoggingIO(cli, ctx.logger);
  io = loggingIO;
  announceRun(ctx, loggingIO, { projectDir, resume: args.resume, ...(args.command === 'ask' ? { mode: 'ask' } : {}) });
  const { config, logger, runner, repo, abortController } = ctx;
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
    let job: SelectedJob;
    if (args.command === 'ask') {
      const outcome = await runAsk({ runner, io: loggingIO, store: new HandoffStore(projectDir), resume: args.resume });
      if (outcome.kind === 'exit') {
        logger.log('INFO', 'run.end', { mode: 'ask' });
        return;
      }
      job = await createJobWithPrompt(repo, askJobPrompt(outcome.handoff), outcome.handoff.title);
      loggingIO.say(`เริ่มงานใหม่ "${outcome.handoff.title}" (${job.id}) — ส่ง handoff ให้ PM แล้ว`, 'success');
    } else {
      job = await selectJob(repo, loggingIO, { resume: args.resume });
    }
    jobId = job.id;
    logger.log('INFO', 'job.selected', { jobId, resume: args.resume });
    const final = await runTeam({
      runner,
      io: loggingIO,
      store: job.store,
      config,
      log: logger,
      levelPreference: args.level,
      snapshots: ctx.snapshots,
      projectDir,
      abortSignal: abortController.signal,
    });
    console.log(
      final.phase === 'DONE'
        ? '\nเสร็จสมบูรณ์'
        : `\nยกเลิกงานแล้ว (state ยังอยู่ใน .agent-team/jobs/${jobId}/)`,
    );
    logger.log('INFO', 'run.end', { phase: final.phase, jobId });
  } catch (e) {
    console.error(`\nหยุดเพราะ error: ${e instanceof Error ? e.message : String(e)}`);
    if (jobId) console.error('รันใหม่แล้วเลือกงานนี้จากเมนู หรือใช้ --resume เพื่อทำต่องานล่าสุด');
    console.error(`ดูสาเหตุ: agent-team logs "${projectDir}"`);
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
