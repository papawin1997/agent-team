import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { type RoleName, SKILLS_PLUGIN_DIR, type TeamConfig } from './config';
import type { PlanInput, PmInput, QaInput, RoleRunner, WorkInput } from './deps';
import { buildQueryOptions } from './options';
import { buildPlanPrompt, buildQaPrompt, buildWorkPrompt, SYSTEM_PROMPTS } from './prompts';
import {
  type Design,
  DesignSchema,
  type PmTurn,
  PmTurnSchema,
  type QAReport,
  QAReportSchema,
  type WorkerResult,
  WorkerResultSchema,
  toJsonSchema,
} from './schemas';

export class RoleRunError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'RoleRunError';
  }
}

export class RoleOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleOutputError';
  }
}

type QueryFn = typeof query;

export interface SdkRunnerDeps {
  projectDir: string;
  config: TeamConfig;
  skillsPluginDir?: string;
  queryFn?: QueryFn;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  debug?: boolean;
  abortController?: AbortController;
}

const BACKOFF_MS = [1000, 3000];

export class SdkRoleRunner implements RoleRunner {
  private readonly queryFn: QueryFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: SdkRunnerDeps) {
    this.queryFn = deps.queryFn ?? query;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = deps.log ?? (() => {});
  }

  async pmTurn(input: PmInput): Promise<{ turn: PmTurn; sessionId: string }> {
    const out = await this.runValidated('pm', input.prompt, PmTurnSchema, input.sessionId);
    return { turn: out.data, sessionId: out.sessionId };
  }

  async plan(input: PlanInput): Promise<Design> {
    return (await this.runValidated('planning', buildPlanPrompt(input), DesignSchema)).data;
  }

  async work(input: WorkInput): Promise<WorkerResult> {
    return (await this.runValidated(input.task.owner, buildWorkPrompt(input), WorkerResultSchema)).data;
  }

  async qa(input: QaInput): Promise<QAReport> {
    return (await this.runValidated('qa', buildQaPrompt(input), QAReportSchema)).data;
  }

  private async runValidated<T>(
    role: RoleName,
    prompt: string,
    schema: z.ZodType<T>,
    resume?: string,
  ): Promise<{ data: T; sessionId: string }> {
    const jsonSchema = toJsonSchema(schema);
    const first = await this.withRetry(role, prompt, jsonSchema, resume);
    const parsed = schema.safeParse(first.output);
    if (parsed.success) return { data: parsed.data, sessionId: first.sessionId };

    const reask =
      `ผลลัพธ์ก่อนหน้าไม่ผ่านการตรวจ schema:\n${z.prettifyError(parsed.error)}\n` +
      'ส่งผลลัพธ์ใหม่ให้ตรง schema';
    const second = await this.withRetry(role, reask, jsonSchema, first.sessionId);
    const reparsed = schema.safeParse(second.output);
    if (reparsed.success) return { data: reparsed.data, sessionId: second.sessionId };
    throw new RoleOutputError(`${role}: output ผิด schema ซ้ำ:\n${z.prettifyError(reparsed.error)}`);
  }

  private async withRetry(
    role: RoleName,
    prompt: string,
    jsonSchema: Record<string, unknown>,
    resume?: string,
  ): Promise<{ output: unknown; sessionId: string }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(role, prompt, jsonSchema, resume);
      } catch (e) {
        const retryable = !(e instanceof RoleRunError) || e.retryable;
        const aborted = this.deps.abortController?.signal.aborted ?? false;
        if (aborted || !retryable || attempt >= BACKOFF_MS.length) throw e;
        const reason = e instanceof Error ? e.message : String(e);
        this.log(`[${role}] ล้มเหลว (${reason}) — retry ครั้งที่ ${attempt + 1}`);
        await this.sleep(BACKOFF_MS[attempt] ?? 3000);
      }
    }
  }

  private async once(
    role: RoleName,
    prompt: string,
    jsonSchema: Record<string, unknown>,
    resume?: string,
  ): Promise<{ output: unknown; sessionId: string }> {
    let sessionId = resume ?? '';
    const stream = this.queryFn({
      prompt,
      options: buildQueryOptions({
        role,
        config: this.deps.config.roles[role],
        projectDir: this.deps.projectDir,
        skillsPluginDir: this.deps.skillsPluginDir ?? SKILLS_PLUGIN_DIR,
        systemPrompt: SYSTEM_PROMPTS[role],
        jsonSchema,
        resume,
        abortController: this.deps.abortController,
      }),
    });

    for await (const msg of stream) {
      if ('session_id' in msg && typeof msg.session_id === 'string') sessionId = msg.session_id;
      if (msg.type === 'system' && msg.subtype === 'init' && this.deps.debug) {
        const init = msg as unknown as { skills?: unknown; plugins?: unknown; tools?: unknown };
        this.log(
          `[${role}] init skills=${JSON.stringify(init.skills)} plugins=${JSON.stringify(init.plugins)} tools=${JSON.stringify(init.tools)}`,
        );
      }
      if (msg.type === 'result') {
        if (msg.subtype === 'success' && msg.structured_output !== undefined) {
          return { output: msg.structured_output, sessionId };
        }
        throw new RoleRunError(`${role}: ${msg.subtype}`, !msg.subtype.startsWith('error_max_'));
      }
    }
    throw new RoleRunError(`${role}: stream จบโดยไม่มี result`, true);
  }
}
