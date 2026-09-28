import type { TeamConfig } from './config';
import type { Logger } from './logger';
import type { Design, Level, PmTurn, QAReport, Requirements, SecurityReport, Task, WorkerResult } from './schemas';
import type { State } from './state';
import type { RoundDiff, SnapshotProvider } from './snapshot';

export interface PmInput {
  prompt: string;
  sessionId?: string;
}

export interface PlanInput {
  requirements: Requirements;
  previousDesign?: Design;
  feedback?: string;
}

export interface WorkInput {
  task: Task;
  design: Design;
  requirements: Requirements;
  previousReport?: QAReport;
  /** มีค่า = ทำต่อใน session เดิมของ worker (รอบแก้) ด้วย prompt สั้นที่มีแค่ผล QA */
  resumeSessionId?: string;
}

export interface WorkOutput {
  result: WorkerResult;
  /** session ของ worker รอบนี้ (ใช้ resume รอบแก้ถัดไป) */
  sessionId: string;
}

export interface QaInput {
  task: Task;
  result: WorkerResult;
  design: Design;
  requirements: Requirements;
  /** รอบแก้: สิ่งที่ worker เปลี่ยนในรอบนี้ — มีค่า = QA ตรวจเฉพาะ diff + ปัญหาเดิม */
  roundDiff?: RoundDiff;
  /** รอบแก้: ผล QA รอบก่อน (ใช้คู่กับ roundDiff) */
  previousReport?: QAReport;
}

export interface SecurityDesignInput {
  design: Design;
  requirements: Requirements;
}

export interface RoleRunner {
  pmTurn(input: PmInput): Promise<{ turn: PmTurn; sessionId: string }>;
  plan(input: PlanInput): Promise<Design>;
  work(input: WorkInput): Promise<WorkOutput>;
  qa(input: QaInput): Promise<QAReport>;
  securityDesign(input: SecurityDesignInput): Promise<string[]>;
  security(input: QaInput): Promise<SecurityReport>;
}

export interface UserIO {
  say(text: string): void;
  ask(prompt: string): Promise<string>;
  choose<T extends string>(prompt: string, options: readonly T[]): Promise<T>;
  chooseOrText<T extends string>(prompt: string, options: readonly T[]): Promise<T | { text: string }>;
}

export interface StateStore {
  load(): Promise<State | undefined>;
  save(state: State): Promise<void>;
  saveArtifact(name: string, data: unknown): Promise<void>;
}

export interface Deps {
  runner: RoleRunner;
  io: UserIO;
  store: StateStore;
  config: TeamConfig;
  log?: Logger;
  /** จาก --quick / --full: บอก PM ว่าผู้ใช้อยากได้ระดับไหน (full = ไม่เสนอ quick) */
  levelPreference?: Level;
  /** snapshot working tree เพื่อหา diff ของรอบแก้ ไม่มี = QA ตรวจทั้ง task ทุกรอบ */
  snapshots?: SnapshotProvider;
  /** ส่งมาจาก ctx.abortController.signal — ใช้เช็คตอน resume worker ล้ม: กำลังถูก abort อยู่ให้โยนต่อ ไม่ fallback ไปเปิด session ใหม่ */
  abortSignal?: AbortSignal;
}

/**
 * ถือ flag "บอก PM เรื่อง levelPreference ไปแล้วหรือยังในการรันนี้" เป็นตัวแปรของการรันแต่ละครั้ง
 * (ไม่ใช่ field ใน Deps ซึ่งเป็นของที่ส่งเข้ามาจากข้างนอกและอาจถูกใช้ซ้ำข้ามการรัน เช่นในเทสต์หรือ headless runner)
 * runTeam สร้างอันใหม่ทุกครั้งที่เรียก แล้วส่งเข้า runRequirements — กันไม่ให้บอกซ้ำทุกครั้งที่กลับเข้า
 * REQUIREMENTS ในรอบรันเดียวกัน (เช่น ขอแก้ requirements หรือ change ตอน DELIVER)
 */
export interface LevelHintState {
  sent: boolean;
}
