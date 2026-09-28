import * as path from 'node:path';
import { JOB_ID_RE } from './jobs';
import type { Level } from './schemas';

export type Command = 'run' | 'logs';

export interface CliArgs {
  /** logs = agent-team logs (ดู log เป็น HTML) */
  command: Command;
  /** undefined = ให้เลือกจากเมนูโปรเจกต์ (โหมด headless ไม่ระบุ = cwd) */
  projectDir: string | undefined;
  resume: boolean;
  /** agent-team logs --live */
  live: boolean;
  /** --quick / --full */
  level: Level | undefined;
  /** run --headless: ไม่มีเมนู ไม่อ่าน stdin คุยผ่านไฟล์ใน .agent-team/jobs/<id>/ (มี key นี้เฉพาะตอนใส่ flag) */
  headless?: true;
  /** run --headless --request "...": ข้อความแรกถึง PM ของงานใหม่ */
  request?: string;
  /** run --headless --job <id>: ทำต่องานที่ระบุ */
  job?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  // logs/run เป็นคำสั่งย่อยเฉพาะตำแหน่งแรก (โฟลเดอร์ชื่อ logs/run ให้พิมพ์ ./logs, ./run)
  // run เขียนหรือไม่เขียนก็ได้ (agent-team run --headless ... เท่ากับ agent-team --headless ...)
  const command: Command = argv[0] === 'logs' ? 'logs' : 'run';
  const rest = argv[0] === 'logs' || argv[0] === 'run' ? argv.slice(1) : argv;
  let projectDir: string | undefined;
  let resume = false;
  let live = false;
  let level: Level | undefined;
  let headless = false;
  let request: string | undefined;
  let job: string | undefined;
  const setProject = (value: string): void => {
    if (projectDir !== undefined) throw new Error('ระบุโปรเจกต์ได้ครั้งเดียว');
    projectDir = value;
  };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? '';
    if (arg === '--resume' || arg === '-r') resume = true;
    else if (arg === '--live') live = true;
    else if (arg === '--headless') headless = true;
    else if (arg === '--request' || arg === '--job') {
      const value = rest[++i];
      if (value === undefined || value === '') throw new Error(`ต้องระบุค่าหลัง ${arg}`);
      if (arg === '--request') request = value;
      else job = value;
    } else if (arg === '--quick' || arg === '--full') {
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
  if (headless && command === 'logs') throw new Error('--headless ใช้กับ agent-team logs ไม่ได้');
  if ((request !== undefined || job !== undefined) && !headless) {
    throw new Error('--request/--job ใช้คู่กับ --headless เท่านั้น');
  }
  if (headless) {
    const modes = [request !== undefined, resume, job !== undefined].filter(Boolean).length;
    if (modes !== 1) {
      throw new Error('--headless ต้องมีอย่างใดอย่างหนึ่ง: --request "..." (งานใหม่), --resume หรือ --job <id>');
    }
    if (request !== undefined && request.trim() === '') throw new Error('--request ห้ามว่าง');
    if (job !== undefined && !JOB_ID_RE.test(job)) throw new Error(`jobId ไม่ถูกรูปแบบ: ${job}`);
  }
  const dir = projectDir ?? (headless ? '.' : undefined);
  return {
    command,
    projectDir: dir === undefined ? undefined : path.resolve(dir),
    resume,
    live,
    level,
    ...(headless ? { headless: true as const, request, job } : {}),
  };
}
