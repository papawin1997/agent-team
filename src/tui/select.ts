import type { StatusSink } from '../activity';
import { CliIO } from '../cli';
import type { UserIO } from '../deps';
import { colorEnabled } from '../style';
import { mountApp } from './app';
import { TuiIO } from './tui-io';

export type UiKind = 'tui' | 'classic';

/** หน้าจอโหมดโต้ตอบ: UI ใหม่ (TuiIO) หรือแบบเดิม (CliIO) — index ใช้ status กับ close ด้วย */
export interface TerminalIO extends UserIO {
  readonly status: StatusSink;
  close(): void;
}

/** UI ใหม่เฉพาะ terminal จริงที่เปิด raw mode ได้ ; AGENT_TEAM_UI=classic = ใช้แบบเดิมเสมอ */
export function pickUi(o: { stdinTTY: boolean; stdoutTTY: boolean; rawMode: boolean; env: NodeJS.ProcessEnv }): UiKind {
  if (o.env.AGENT_TEAM_UI === 'classic') return 'classic';
  return o.stdinTTY && o.stdoutTTY && o.rawMode ? 'tui' : 'classic';
}

export function createTerminalIO(o: { env?: NodeJS.ProcessEnv; warn?: (message: string) => void } = {}): TerminalIO {
  const env = o.env ?? process.env;
  const kind = pickUi({
    stdinTTY: process.stdin.isTTY === true,
    stdoutTTY: process.stdout.isTTY === true,
    rawMode: typeof process.stdin.setRawMode === 'function',
    env,
  });
  if (kind === 'tui') {
    try {
      return new TuiIO({
        color: colorEnabled(process.stdout, env),
        // Ctrl+C ส่งต่อเป็น SIGINT เหมือน CliIO ให้ handler หยุดงานใน index ทำงาน
        mount: (store) => mountApp(store, () => process.emit('SIGINT')),
      });
    } catch (e) {
      const warn = o.warn ?? ((message: string) => console.error(message));
      warn(`เปิดหน้าจอแบบใหม่ไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — ใช้หน้าจอแบบเดิมแทน`);
    }
  }
  return new CliIO();
}
