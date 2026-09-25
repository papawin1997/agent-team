import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from './args';
import { CliIO } from './cli';
import { loadConfig } from './config';
import { presentBillingVars } from './env';
import { FileLogger, LoggingIO } from './logger';
import { runTeam } from './orchestrator';
import { SdkRoleRunner } from './runner';
import { FileStateStore } from './state';

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
  const store = new FileStateStore(path.join(args.projectDir, '.agent-team'));

  process.on('SIGINT', () => {
    logger.log('WARN', 'run.interrupted', { signal: 'SIGINT' });
    abortController.abort();
    cli.close();
    console.log('\nหยุดแล้ว — state ถูกบันทึกไว้ใน .agent-team/ รันต่อด้วย --resume');
    process.exit(130);
  });

  try {
    const final = await runTeam({ runner, io, store, config, log: logger });
    console.log(
      final.phase === 'DONE'
        ? '\nเสร็จสมบูรณ์'
        : '\nยกเลิกงานแล้ว (state ยังอยู่ใน .agent-team/)',
    );
    logger.log('INFO', 'run.end', { phase: final.phase });
  } catch (e) {
    console.error(`\nหยุดเพราะ error: ${e instanceof Error ? e.message : String(e)}`);
    console.error('รันต่อได้ด้วย --resume');
    logger.log('ERROR', 'run.error', {
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    process.exitCode = 1;
  } finally {
    cli.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
