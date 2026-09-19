import * as fs from 'node:fs';
import { parseArgs } from './args';
import { CliIO } from './cli';
import { loadConfig } from './config';
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
  const io = new CliIO();
  const runner = new SdkRoleRunner({
    projectDir: args.projectDir,
    config,
    abortController,
    log: (line) => io.say(line),
    debug: process.env.AGENT_TEAM_DEBUG === '1',
  });
  const store = new FileStateStore(args.projectDir);

  process.on('SIGINT', () => {
    abortController.abort();
    io.close();
    console.log('\nหยุดแล้ว — state ถูกบันทึกไว้ใน .agent-team/ รันต่อด้วย --resume');
    process.exit(130);
  });

  try {
    const final = await runTeam({ runner, io, store, config }, { resume: args.resume });
    console.log(
      final.phase === 'DONE'
        ? '\nเสร็จสมบูรณ์'
        : '\nยกเลิกงานแล้ว (state ยังอยู่ใน .agent-team/)',
    );
  } catch (e) {
    console.error(`\nหยุดเพราะ error: ${e instanceof Error ? e.message : String(e)}`);
    console.error('รันต่อได้ด้วย --resume');
    process.exitCode = 1;
  } finally {
    io.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
