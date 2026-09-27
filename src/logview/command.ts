import * as fs from 'node:fs';
import * as path from 'node:path';
import { openInBrowser } from './open-browser';
import { renderHtml } from './render';
import { startLiveServer, type LiveServer } from './serve';
import { createTranscriptCache, transcriptsDir } from './transcripts';
import { buildViewData, type ViewData } from './view-data';

export interface LogsCommandDeps {
  say: (text: string) => void;
  /** เปิดไฟล์/URL (เทสต์ส่งตัวปลอมได้) */
  open?: (target: string) => void;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** agent-team logs: คืน LiveServer เมื่อ live (ผู้เรียกต้อง close เอง) */
export async function runLogsCommand(
  projectDir: string,
  live: boolean,
  deps: LogsCommandDeps,
): Promise<LiveServer | undefined> {
  const logFile = path.join(projectDir, '.agent-team', 'agent-team.log');
  if (!fs.existsSync(logFile)) {
    throw new Error(`ไม่พบ log: ${logFile} (โปรเจกต์นี้ยังไม่เคยรัน agent-team)`);
  }
  const dir = transcriptsDir(projectDir, deps.env, deps.home);
  const open = deps.open ?? ((target: string) => openInBrowser(target));

  if (live) {
    // cache เดียวใช้ตลอดอายุ server: กันอ่าน/พาร์ส transcript ที่ไม่เปลี่ยนซ้ำทุกครั้งที่ /data ถูก poll
    const cache = createTranscriptCache();
    const load = (): ViewData =>
      buildViewData({ projectDir, logFile, logText: fs.readFileSync(logFile, 'utf8'), transcriptsDir: dir, cache });
    const server = await startLiveServer({ load });
    deps.say(`เปิดหน้า log แบบ live ที่ ${server.url} (กด Ctrl+C เพื่อหยุด)`);
    open(server.url);
    return server;
  }
  const out = path.join(projectDir, '.agent-team', 'logs.html');
  const data = buildViewData({ projectDir, logFile, logText: fs.readFileSync(logFile, 'utf8'), transcriptsDir: dir });
  fs.writeFileSync(out, renderHtml(data), 'utf8');
  deps.say(`สร้างหน้า log แล้ว: ${out}`);
  open(out);
  return undefined;
}
