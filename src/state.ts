import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StateStore } from './deps';
import { renameWithRetry } from './fs-retry';
import type { Design, Level, QAReport, QuickTask, Requirements } from './schemas';

export type Phase =
  | 'REQUIREMENTS'
  | 'DESIGN'
  | 'REVIEW'
  | 'BUILD'
  | 'DELIVER'
  | 'DONE'
  | 'ABORTED';

export interface TaskProgress {
  rounds: number;
  maxRounds: number;
  done: boolean;
  acceptedWithIssues: boolean;
  securityReviewed: boolean;
  lastReport?: QAReport;
  /** session ของ worker รอบล่าสุด — รอบแก้ถัดไป resume ต่อได้ (ไม่มี = เปิดใหม่) */
  workerSessionId?: string;
  /** จำนวนครั้งที่ resume session นี้ติดกัน (ครบ MAX_WORKER_RESUMES แล้วรอบถัดไปเปิด session ใหม่) */
  workerResumes?: number;
  /** snapshot (after) ของรอบล่าสุดที่ QA ตรวจจริง (PASS/FAIL รวม security-merged FAIL) — baseline ของ diff รอบถัดไป ไม่มี = รอบถัดไปตรวจทั้ง task */
  reviewedTree?: string;
  /** รอบก่อนหน้าชนขีดจำกัด SDK (worker หรือ QA) — รอบถัดไปตรวจทั้ง task และ worker ต้องเปิด session ใหม่ ห้าม resume */
  lastRoundLimit?: boolean;
  /** snapshot ก่อน worker รอบแรกของ task นี้ ใช้หาไฟล์ทั้งหมดที่ task แตะ (ตัดสิน Security ของ quick/standard) */
  startTree?: string;
}

export interface State {
  version: 1;
  phase: Phase;
  /** ชื่องาน จากข้อความแรกที่ user พิมพ์ใน REQUIREMENTS */
  title?: string;
  /** ISO 8601 ตั้งทุกครั้งที่ save */
  updatedAt?: string;
  /** ISO 8601 ตั้งตอน save ในเฟส BUILD ที่มีรอบแล้ว (worker แก้โค้ดได้แค่ในเฟสนี้) */
  lastBuildAt?: string;
  pmSessionId?: string;
  pendingPrompt?: string;
  designFeedback?: string;
  requirements?: Requirements;
  design?: Design;
  /** ระดับงานที่เลือก — ไม่มี = full (งานเก่าก่อนมีโหมด quick) */
  level?: Level;
  /** งานเดียวของโหมด quick (มีเฉพาะตอน level = quick) */
  quickTask?: QuickTask;
  progress: Record<string, TaskProgress>;
  /**
   * design จริงของงาน full ที่เก็บไว้ตอนถูก triage เป็น quick (เฉพาะตอนมี design จริงอยู่ก่อนแล้ว ไม่ใช่
   * design สังเคราะห์ของ quick เอง) — ใช้คืนกลับตอนงานถูกยกระดับเป็น full อีกครั้ง จะได้ไม่เสีย design เดิม
   */
  baseDesign?: Design;
  /** progress ของ baseDesign ณ ตอนที่ถูกเก็บไว้ (คู่กับ baseDesign) */
  baseProgress?: Record<string, TaskProgress>;
}

export function newState(): State {
  return { version: 1, phase: 'REQUIREMENTS', progress: {} };
}

/** เก็บ state และ artifact ของงานหนึ่งงานในโฟลเดอร์ .agent-team/jobs/<jobId>/ */
export class FileStateStore implements StateStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
    /** เทสต์ส่ง rename ที่ล้มได้ */
    private readonly opts: { rename?: (from: string, to: string) => Promise<void> } = {},
  ) {}

  async load(): Promise<State | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(this.dir, 'state.json'), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
    const parsed = JSON.parse(raw) as { version?: number };
    if (parsed.version !== 1) {
      throw new Error(`state.json มี version ที่ไม่รองรับ: ${String(parsed.version)}`);
    }
    return parsed as State;
  }

  async save(state: State): Promise<void> {
    const at = this.now().toISOString();
    state.updatedAt = at;
    if (state.phase === 'BUILD' && Object.values(state.progress).some((p) => p.rounds > 0)) {
      state.lastBuildAt = at;
    }
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, 'state.json');
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    // คำสั่ง wait/status อ่าน state.json ทุกวินาที: บน Windows rename ทับไฟล์ที่เปิดอยู่ล้มชั่วคราวได้
    await renameWithRetry(tmp, file, { rename: this.opts.rename });
  }

  async saveArtifact(name: string, data: unknown): Promise<void> {
    const file = path.join(this.dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }
}
