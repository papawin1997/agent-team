import { query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { agentLabel, describeToolUse, nullStatus, type StatusSink } from './activity';
import { type RoleName, SKILLS_PLUGIN_DIR, type TeamConfig } from './config';
import type { PlanInput, PmInput, QaInput, RoleRunner, SecurityDesignInput, WorkInput } from './deps';
import { RoleOutputError, RoleRunError } from './errors';
import { type Logger, nullLogger } from './logger';
import { buildQueryOptions } from './options';
import {
  buildPlanPrompt,
  buildQaPrompt,
  buildSecurityDesignPrompt,
  buildSecurityPrompt,
  buildWorkPrompt,
  SYSTEM_PROMPTS,
} from './prompts';
import {
  type Design,
  DesignSchema,
  type PmTurn,
  PmTurnSchema,
  type QAReport,
  QAReportSchema,
  SecurityDesignReviewSchema,
  type SecurityReport,
  SecurityReportSchema,
  type WorkerResult,
  WorkerResultSchema,
  toJsonSchema,
} from './schemas';

export { RoleOutputError, RoleRunError } from './errors';

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
  logger?: Logger;
  /** บรรทัดสถานะระหว่าง agent ทำงาน (index.ts ส่ง cli.status) */
  status?: StatusSink;
}

const BACKOFF_MS = [1000, 3000];

export class SdkRoleRunner implements RoleRunner {
  private readonly queryFn: QueryFn;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (line: string) => void;
  private readonly logger: Logger;
  private readonly status: StatusSink;

  constructor(private readonly deps: SdkRunnerDeps) {
    this.logger = deps.logger ?? nullLogger;
    this.queryFn = deps.queryFn ?? query;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = deps.log ?? (() => {});
    this.status = deps.status ?? nullStatus;
  }

  async pmTurn(input: PmInput): Promise<{ turn: PmTurn; sessionId: string }> {
    const out = await this.runValidated('pm', agentLabel('pm'), input.prompt, PmTurnSchema, input.sessionId);
    return { turn: out.data, sessionId: out.sessionId };
  }

  async plan(input: PlanInput): Promise<Design> {
    return (await this.runValidated('planning', agentLabel('planning'), buildPlanPrompt(input), DesignSchema)).data;
  }

  async work(input: WorkInput): Promise<WorkerResult> {
    const { owner, id } = input.task;
    return (await this.runValidated(owner, agentLabel(owner, id), buildWorkPrompt(input), WorkerResultSchema)).data;
  }

  async qa(input: QaInput): Promise<QAReport> {
    return (await this.runValidated('qa', agentLabel('qa', input.task.id), buildQaPrompt(input), QAReportSchema)).data;
  }

  async securityDesign(input: SecurityDesignInput): Promise<string[]> {
    const out = await this.runValidated(
      'security',
      agentLabel('security'),
      buildSecurityDesignPrompt(input),
      SecurityDesignReviewSchema,
    );
    return out.data.securityNotes;
  }

  async security(input: QaInput): Promise<SecurityReport> {
    const label = agentLabel('security', input.task.id);
    return (await this.runValidated('security', label, buildSecurityPrompt(input), SecurityReportSchema)).data;
  }

  private async runValidated<T>(
    role: RoleName,
    label: string,
    prompt: string,
    schema: z.ZodType<T>,
    resume?: string,
  ): Promise<{ data: T; sessionId: string }> {
    const jsonSchema = toJsonSchema(schema);
    const first = await this.withRetry(role, label, prompt, jsonSchema, resume);
    const parsed = schema.safeParse(first.output);
    if (parsed.success) return { data: parsed.data, sessionId: first.sessionId };

    const reask =
      `ผลลัพธ์ก่อนหน้าไม่ผ่านการตรวจ schema:\n${z.prettifyError(parsed.error)}\n` +
      'ส่งผลลัพธ์ใหม่ให้ตรง schema';
    const second = await this.withRetry(role, label, reask, jsonSchema, first.sessionId);
    const reparsed = schema.safeParse(second.output);
    if (reparsed.success) return { data: reparsed.data, sessionId: second.sessionId };
    throw new RoleOutputError(`${role}: output ผิด schema ซ้ำ:\n${z.prettifyError(reparsed.error)}`);
  }

  private async withRetry(
    role: RoleName,
    label: string,
    prompt: string,
    jsonSchema: Record<string, unknown>,
    resume?: string,
  ): Promise<{ output: unknown; sessionId: string }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(role, label, prompt, jsonSchema, resume);
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
    label: string,
    prompt: string,
    jsonSchema: Record<string, unknown>,
    resume?: string,
  ): Promise<{ output: unknown; sessionId: string }> {
    let sessionId = resume ?? '';
    this.logger.log('INFO', 'agent.start', {
      role,
      model: this.deps.config.roles[role].model,
      resumed: resume !== undefined,
      promptChars: prompt.length,
    });
    this.status.start(label);
    try {
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
          logger: this.deps.logger,
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
        if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (block.type === 'tool_use') this.status.update(describeToolUse(block.name, block.input));
          }
        }
        if (msg.type === 'result') {
          const ok = msg.subtype === 'success' && msg.structured_output !== undefined;
          this.logger.log(ok ? 'INFO' : 'WARN', 'agent.result', {
            role,
            subtype: msg.subtype,
            durationMs: msg.duration_ms,
            turns: msg.num_turns,
            costUsd: msg.total_cost_usd,
            sessionId,
          });
          if (ok) return { output: msg.structured_output, sessionId };
          throw new RoleRunError(
            `${role}: ${msg.subtype}`,
            !msg.subtype.startsWith('error_max_'),
            msg.subtype,
          );
        }
      }
      this.logger.log('WARN', 'agent.no_result', { role, sessionId });
      throw new RoleRunError(`${role}: stream จบโดยไม่มี result`, true);
    } finally {
      this.status.stop();
    }
  }
}
