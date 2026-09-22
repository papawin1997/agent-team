import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export type RoleName = 'pm' | 'planning' | 'frontend' | 'backend' | 'qa';
export const ROLE_NAMES: readonly RoleName[] = ['pm', 'planning', 'frontend', 'backend', 'qa'];

export interface RoleConfig {
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  tools: string[];
  allowedTools: string[];
  skills: string[];
}

export interface TeamConfig {
  maxQaRounds: number;
  extraRoundsOnContinue: number;
  roles: Record<RoleName, RoleConfig>;
}

export const TEAM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_PLUGIN_DIR = path.join(TEAM_ROOT, 'skills');

export const TEST_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)(tests?|__tests__|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go)$/,
];

const READ_TOOLS = ['Read', 'Glob', 'Grep'];
const WORK_TOOLS = [...READ_TOOLS, 'Edit', 'Write', 'Bash'];
const BASH_ALLOW = [
  'Bash(npm *)',
  'Bash(npx *)',
  'Bash(pnpm *)',
  'Bash(yarn *)',
  'Bash(node *)',
  'Bash(python *)',
  'Bash(pytest *)',
  'Bash(pip *)',
  'Bash(go *)',
];
const GIT_READ_ONLY = ['status', 'diff', 'log', 'show', 'ls-files', 'rev-parse', 'blame'];
const GIT_ALLOW = GIT_READ_ONLY.flatMap((sub) => [`Bash(git ${sub})`, `Bash(git ${sub} *)`]);
const WORK_ALLOWED = [...READ_TOOLS, 'Edit', 'Write', ...BASH_ALLOW, ...GIT_ALLOW];

const SONNET = 'claude-sonnet-5';
const OPUS = 'claude-opus-5';

export const DEFAULT_CONFIG: TeamConfig = {
  maxQaRounds: 5,
  extraRoundsOnContinue: 5,
  roles: {
    pm: { model: SONNET, maxTurns: 20, maxBudgetUsd: 2, tools: READ_TOOLS, allowedTools: READ_TOOLS, skills: [] },
    planning: { model: OPUS, maxTurns: 40, maxBudgetUsd: 5, tools: READ_TOOLS, allowedTools: READ_TOOLS, skills: [] },
    frontend: { model: SONNET, maxTurns: 80, maxBudgetUsd: 5, tools: WORK_TOOLS, allowedTools: WORK_ALLOWED, skills: [] },
    backend: { model: SONNET, maxTurns: 80, maxBudgetUsd: 5, tools: WORK_TOOLS, allowedTools: WORK_ALLOWED, skills: [] },
    qa: { model: SONNET, maxTurns: 60, maxBudgetUsd: 4, tools: WORK_TOOLS, allowedTools: WORK_ALLOWED, skills: [] },
  },
};

const RoleOverrideSchema = z
  .object({
    model: z.string().optional(),
    maxTurns: z.number().int().positive().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    skills: z.array(z.string()).optional(),
  })
  .strict();

const ConfigOverrideSchema = z
  .object({
    maxQaRounds: z.number().int().positive().optional(),
    extraRoundsOnContinue: z.number().int().positive().optional(),
    roles: z
      .object({
        pm: RoleOverrideSchema.optional(),
        planning: RoleOverrideSchema.optional(),
        frontend: RoleOverrideSchema.optional(),
        backend: RoleOverrideSchema.optional(),
        qa: RoleOverrideSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function mergeConfig(base: TeamConfig, override: unknown): TeamConfig {
  const parsed = ConfigOverrideSchema.parse(override);
  const roles = { ...base.roles };
  for (const name of ROLE_NAMES) {
    const patch = parsed.roles?.[name];
    if (!patch) continue;
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    roles[name] = { ...roles[name], ...defined };
  }
  return {
    maxQaRounds: parsed.maxQaRounds ?? base.maxQaRounds,
    extraRoundsOnContinue: parsed.extraRoundsOnContinue ?? base.extraRoundsOnContinue,
    roles,
  };
}

export function loadConfig(file: string = path.join(TEAM_ROOT, 'agent-team.config.json')): TeamConfig {
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;
  return mergeConfig(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(file, 'utf8')));
}
