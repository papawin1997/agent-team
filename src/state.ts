import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StateStore } from './deps';
import type { Design, QAReport, Requirements } from './schemas';

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
  progress: Record<string, TaskProgress>;
}

export function newState(): State {
  return { version: 1, phase: 'REQUIREMENTS', progress: {} };
}

/** เก็บ state และ artifact ของงานหนึ่งงานในโฟลเดอร์ .agent-team/jobs/<jobId>/ */
export class FileStateStore implements StateStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
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
    await fs.rename(tmp, file);
  }

  async saveArtifact(name: string, data: unknown): Promise<void> {
    const file = path.join(this.dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  }
}
