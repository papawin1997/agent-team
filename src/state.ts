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
  lastReport?: QAReport;
}

export interface State {
  version: 1;
  phase: Phase;
  pmSessionId?: string;
  pendingPrompt?: string;
  requirements?: Requirements;
  design?: Design;
  progress: Record<string, TaskProgress>;
}

export function newState(): State {
  return { version: 1, phase: 'REQUIREMENTS', progress: {} };
}

export class FileStateStore implements StateStore {
  private readonly dir: string;

  constructor(projectDir: string) {
    this.dir = path.join(projectDir, '.agent-team');
  }

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
