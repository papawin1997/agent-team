import type { TeamConfig } from './config';
import type { Logger } from './logger';
import type { Design, PmTurn, QAReport, Requirements, SecurityReport, Task, WorkerResult } from './schemas';
import type { State } from './state';

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
}

export interface QaInput {
  task: Task;
  result: WorkerResult;
  design: Design;
  requirements: Requirements;
}

export interface SecurityDesignInput {
  design: Design;
  requirements: Requirements;
}

export interface RoleRunner {
  pmTurn(input: PmInput): Promise<{ turn: PmTurn; sessionId: string }>;
  plan(input: PlanInput): Promise<Design>;
  work(input: WorkInput): Promise<WorkerResult>;
  qa(input: QaInput): Promise<QAReport>;
  securityDesign(input: SecurityDesignInput): Promise<string[]>;
  security(input: QaInput): Promise<SecurityReport>;
}

export interface UserIO {
  say(text: string): void;
  ask(prompt: string): Promise<string>;
  choose<T extends string>(prompt: string, options: readonly T[]): Promise<T>;
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
}
