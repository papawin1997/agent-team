import { parseChoice } from '../../src/cli';
import { DEFAULT_CONFIG } from '../../src/config';
import type {
  Deps,
  PlanInput,
  PmInput,
  QaInput,
  RoleRunner,
  SecurityDesignInput,
  StateStore,
  UserIO,
  WorkInput,
} from '../../src/deps';
import type { Design, PmTurn, QAReport, SecurityReport, WorkerResult } from '../../src/schemas';
import type { State } from '../../src/state';

export class MemoryStore implements StateStore {
  state: State | undefined;
  artifacts = new Map<string, unknown>();
  saves = 0;

  async load(): Promise<State | undefined> {
    return this.state ? structuredClone(this.state) : undefined;
  }

  async save(state: State): Promise<void> {
    this.state = structuredClone(state);
    this.saves += 1;
  }

  async saveArtifact(name: string, data: unknown): Promise<void> {
    this.artifacts.set(name, structuredClone(data));
  }
}

export class ScriptedIO implements UserIO {
  said: string[] = [];
  asked: string[] = [];
  private answers: string[];

  constructor(answers: string[]) {
    this.answers = [...answers];
  }

  say(text: string): void {
    this.said.push(text);
  }

  async ask(prompt: string): Promise<string> {
    this.asked.push(prompt);
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error(`ScriptedIO: ไม่มีคำตอบเหลือสำหรับ "${prompt}"`);
    return answer;
  }

  async chooseOrText<T extends string>(prompt: string, options: readonly T[]): Promise<T | { text: string }> {
    const answer = await this.ask(prompt);
    const choice = parseChoice(answer, options);
    return choice ?? { text: answer };
  }

  async choose<T extends string>(prompt: string, options: readonly T[]): Promise<T> {
    const result = await this.chooseOrText(prompt, options);
    if (typeof result === 'string') return result;
    throw new Error(`ScriptedIO: "${result.text}" ไม่อยู่ใน ${options.join(',')}`);
  }
}

export interface FakeScript {
  pm?: PmTurn[];
  plans?: Design[];
  /** ต่อ call ของ work: Error = โยน error นั้น, undefined/หมด = คืนผลปกติ */
  work?: Array<Error | undefined>;
  /** ต่อ call ของ qa: Error = โยน error นั้น */
  qa?: Array<QAReport | Error>;
  /** ต่อ call ของ securityDesign: Error = โยน error นั้น, undefined/หมด = คืน [] (ไม่มี note) */
  securityDesign?: Array<string[] | Error>;
  /** ต่อ call ของ security: Error = โยน error นั้น, undefined/หมด = คืน PASS ว่าง (เผื่อ test ที่ไม่สนใจ security) */
  security?: Array<SecurityReport | Error>;
}

export interface RecordedCall {
  role: string;
  input: unknown;
}

export class FakeRunner implements RoleRunner {
  calls: RecordedCall[] = [];
  private pm: PmTurn[];
  private plans: Design[];
  private workScript: Array<Error | undefined>;
  private qaReports: Array<QAReport | Error>;
  private securityDesignScript: Array<string[] | Error>;
  private securityScript: Array<SecurityReport | Error>;

  constructor(script: FakeScript) {
    this.pm = [...(script.pm ?? [])];
    this.plans = [...(script.plans ?? [])];
    this.workScript = [...(script.work ?? [])];
    this.qaReports = [...(script.qa ?? [])];
    this.securityDesignScript = [...(script.securityDesign ?? [])];
    this.securityScript = [...(script.security ?? [])];
  }

  async pmTurn(input: PmInput): Promise<{ turn: PmTurn; sessionId: string }> {
    this.calls.push({ role: 'pm', input });
    const turn = this.pm.shift();
    if (!turn) throw new Error('FakeRunner: pm script หมด');
    return { turn, sessionId: 'pm-session' };
  }

  async plan(input: PlanInput): Promise<Design> {
    this.calls.push({ role: 'planning', input });
    const design = this.plans.shift();
    if (!design) throw new Error('FakeRunner: plans script หมด');
    return design;
  }

  async work(input: WorkInput): Promise<WorkerResult> {
    this.calls.push({ role: input.task.owner, input });
    const scripted = this.workScript.shift();
    if (scripted) throw scripted;
    return {
      taskId: input.task.id,
      summary: `ทำ ${input.task.id}`,
      filesChanged: [`src/${input.task.id}.ts`],
      howToVerify: 'npm test',
    };
  }

  async qa(input: QaInput): Promise<QAReport> {
    this.calls.push({ role: 'qa', input });
    const report = this.qaReports.shift();
    if (!report) throw new Error('FakeRunner: qa script หมด');
    if (report instanceof Error) throw report;
    return report;
  }

  async securityDesign(input: SecurityDesignInput): Promise<string[]> {
    this.calls.push({ role: 'security', input });
    const scripted = this.securityDesignScript.shift();
    if (scripted instanceof Error) throw scripted;
    return scripted ?? [];
  }

  async security(input: QaInput): Promise<SecurityReport> {
    this.calls.push({ role: 'security', input });
    const scripted = this.securityScript.shift();
    if (scripted instanceof Error) throw scripted;
    return scripted ?? { taskId: input.task.id, verdict: 'PASS', issues: [] };
  }
}

export function makeDeps(script: FakeScript, answers: string[]) {
  const runner = new FakeRunner(script);
  const io = new ScriptedIO(answers);
  const store = new MemoryStore();
  const deps: Deps = { runner, io, store, config: DEFAULT_CONFIG };
  return { deps, runner, io, store };
}
