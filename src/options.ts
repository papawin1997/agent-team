import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { type RoleConfig, type RoleName, TEST_PATH_PATTERNS } from './config';
import { agentEnv } from './env';
import { createGuardHook } from './guard';
import type { Logger } from './logger';

export interface BuildOptionsInput {
  role: RoleName;
  config: RoleConfig;
  projectDir: string;
  skillsPluginDir: string;
  systemPrompt: string;
  jsonSchema?: Record<string, unknown>;
  resume?: string;
  abortController?: AbortController;
  logger?: Logger;
}

export function buildQueryOptions(input: BuildOptionsInput): Options {
  const { role, config, projectDir, skillsPluginDir } = input;
  const useSkills = config.skills.length > 0;

  const options: Options = {
    cwd: projectDir,
    model: config.model,
    systemPrompt: input.systemPrompt,
    tools: useSkills ? [...new Set([...config.tools, 'Skill'])] : [...config.tools],
    allowedTools: [...config.allowedTools],
    permissionMode: 'dontAsk',
    settingSources: ['project'],
    skills: [...config.skills],
    plugins: useSkills ? [{ type: 'local', path: skillsPluginDir }] : [],
    additionalDirectories: useSkills ? [skillsPluginDir] : [],
    maxTurns: config.maxTurns,
    maxBudgetUsd: config.maxBudgetUsd,
    strictMcpConfig: true,
    env: agentEnv(),
    hooks: {
      PreToolUse: [
        {
          hooks: [
            createGuardHook({
              role,
              projectDir,
              skillsDir: skillsPluginDir,
              testPathPatterns: TEST_PATH_PATTERNS,
              onDeny: input.logger && ((d) => input.logger?.log('WARN', 'guard.deny', d)),
            }),
          ],
        },
      ],
    },
  };
  if (input.jsonSchema) options.outputFormat = { type: 'json_schema', schema: input.jsonSchema };
  if (input.resume) options.resume = input.resume;
  if (input.abortController) options.abortController = input.abortController;
  return options;
}
