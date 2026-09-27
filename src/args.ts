import * as path from 'node:path';
import type { Level } from './schemas';

export type Command = 'run' | 'logs';

export interface CliArgs {
  /** logs = agent-team logs (ดู log เป็น HTML) */
  command: Command;
  /** undefined = ให้เลือกจากเมนูโปรเจกต์ */
  projectDir: string | undefined;
  resume: boolean;
  /** agent-team logs --live */
  live: boolean;
  /** --quick / --full */
  level: Level | undefined;
}

export function parseArgs(argv: string[]): CliArgs {
  // logs เป็นคำสั่งย่อยเฉพาะตำแหน่งแรก (โฟลเดอร์ชื่อ logs ให้พิมพ์ ./logs)
  const command: Command = argv[0] === 'logs' ? 'logs' : 'run';
  const rest = command === 'logs' ? argv.slice(1) : argv;
  let projectDir: string | undefined;
  let resume = false;
  let live = false;
  let level: Level | undefined;
  const setProject = (value: string): void => {
    if (projectDir !== undefined) throw new Error('ระบุโปรเจกต์ได้ครั้งเดียว');
    projectDir = value;
  };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? '';
    if (arg === '--resume' || arg === '-r') resume = true;
    else if (arg === '--live') live = true;
    else if (arg === '--quick' || arg === '--full') {
      const value = arg === '--quick' ? 'quick' : 'full';
      if (level !== undefined && level !== value) throw new Error('ใช้ --quick กับ --full พร้อมกันไม่ได้');
      level = value;
    } else if (arg === '--project') {
      const value = rest[++i];
      if (value === undefined || value === '' || value.startsWith('-')) throw new Error('ต้องระบุพาธหลัง --project');
      setProject(value);
    } else if (arg.startsWith('--project=')) {
      const value = arg.slice('--project='.length);
      if (value === '') throw new Error('ต้องระบุพาธหลัง --project');
      setProject(value);
    } else if (arg.startsWith('-')) throw new Error(`อาร์กิวเมนต์ไม่รู้จัก: ${arg}`);
    else setProject(arg);
  }
  if (live && command !== 'logs') throw new Error('--live ใช้ได้กับ agent-team logs เท่านั้น');
  if (resume && command === 'logs') throw new Error('-r/--resume ใช้กับ agent-team logs ไม่ได้');
  if (level && command === 'logs') throw new Error('--quick/--full ใช้กับ agent-team logs ไม่ได้');
  return { command, projectDir: projectDir === undefined ? undefined : path.resolve(projectDir), resume, live, level };
}
