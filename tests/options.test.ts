import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, ROLE_NAMES } from '../src/config';
import { buildQueryOptions } from '../src/options';

const projectDir = path.resolve('options-test-project');
const skillsPluginDir = path.resolve('options-test-skills');
const base = { projectDir, skillsPluginDir, systemPrompt: 'sys' };

const inside = (...p: string[]) => path.join(projectDir, ...p);
const outside = path.resolve(projectDir, '..', 'elsewhere', 'x.ts');
const inSkillsDir = (...p: string[]) => path.join(skillsPluginDir, ...p);

describe('buildQueryOptions', () => {
  it('role ที่ไม่มี skill: ไม่โหลด plugin และปิด skills', () => {
    const o = buildQueryOptions({ ...base, role: 'pm', config: DEFAULT_CONFIG.roles.pm });
    expect(o.cwd).toBe(projectDir);
    expect(o.model).toBe('claude-sonnet-5');
    expect(o.systemPrompt).toBe('sys');
    expect(o.skills).toEqual([]);
    expect(o.plugins).toEqual([]);
    expect(o.additionalDirectories).toEqual([]);
    expect(o.tools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('ตั้งค่าความปลอดภัยพื้นฐานให้ทุก role', () => {
    const o = buildQueryOptions({ ...base, role: 'backend', config: DEFAULT_CONFIG.roles.backend });
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.settingSources).toEqual(['project']);
    expect(o.strictMcpConfig).toBe(true);
    expect(o.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    expect(o.hooks?.PreToolUse).toHaveLength(1);
    expect(o.maxTurns).toBe(DEFAULT_CONFIG.roles.backend.maxTurns);
    expect(o.maxBudgetUsd).toBe(DEFAULT_CONFIG.roles.backend.maxBudgetUsd);
  });

  it('ไม่ส่ง ANTHROPIC_API_KEY ให้ agent แม้ตั้งไว้ใน shell (ใช้ subscription เท่านั้น)', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    try {
      const o = buildQueryOptions({ ...base, role: 'pm', config: DEFAULT_CONFIG.roles.pm });
      expect(Object.keys(o.env ?? {}).map((k) => k.toUpperCase())).not.toContain('ANTHROPIC_API_KEY');
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('role ที่เปิด skill: เพิ่ม Skill tool, plugin และสิทธิ์อ่านโฟลเดอร์ skill', () => {
    const config = { ...DEFAULT_CONFIG.roles.frontend, skills: ['team:frontend-conventions'] };
    const o = buildQueryOptions({ ...base, role: 'frontend', config });
    expect(o.skills).toEqual(['team:frontend-conventions']);
    expect(o.tools).toContain('Skill');
    expect(o.plugins).toEqual([{ type: 'local', path: skillsPluginDir }]);
    expect(o.additionalDirectories).toEqual([skillsPluginDir]);
  });

  it('ใส่ outputFormat, resume และ abortController เมื่อระบุ', () => {
    const abortController = new AbortController();
    const o = buildQueryOptions({
      ...base,
      role: 'qa',
      config: DEFAULT_CONFIG.roles.qa,
      jsonSchema: { type: 'object' },
      resume: 'sess-1',
      abortController,
    });
    expect(o.outputFormat).toEqual({ type: 'json_schema', schema: { type: 'object' } });
    expect(o.resume).toBe('sess-1');
    expect(o.abortController).toBe(abortController);
  });

  it('ไม่ใส่ outputFormat/resume เมื่อไม่ระบุ', () => {
    const o = buildQueryOptions({ ...base, role: 'qa', config: DEFAULT_CONFIG.roles.qa });
    expect(o.outputFormat).toBeUndefined();
    expect(o.resume).toBeUndefined();
  });

  it('ไม่แก้ array ใน config ต้นฉบับ', () => {
    const config = { ...DEFAULT_CONFIG.roles.frontend, skills: ['team:x'] };
    const before = [...config.tools];
    buildQueryOptions({ ...base, role: 'frontend', config });
    expect(config.tools).toEqual(before);
  });

  // Hook wiring tests
  describe('Hook wiring and role-dependent access', () => {
    it('pm role: Write denied, Bash denied, Read allowed', async () => {
      const o = buildQueryOptions({ ...base, role: 'pm', config: DEFAULT_CONFIG.roles.pm });
      const hook = o.hooks?.PreToolUse?.[0].hooks[0];
      expect(hook).toBeDefined();
      const signal = new AbortController().signal;

      // Write inside projectDir -> denied
      const writeResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: inside('src', 'a.ts') } } as never,
        undefined,
        { signal },
      );
      expect((writeResult as any).hookSpecificOutput?.permissionDecision).toBe('deny');

      // Bash npm test -> denied
      const bashResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } } as never,
        undefined,
        { signal },
      );
      expect((bashResult as any).hookSpecificOutput?.permissionDecision).toBe('deny');

      // Read inside projectDir -> allowed
      const readResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: inside('src', 'a.ts') } } as never,
        undefined,
        { signal },
      );
      expect((readResult as any).hookSpecificOutput).toBeUndefined();
    });

    it('pm role with skills configured: Skill tool allowed via hook', async () => {
      const config = { ...DEFAULT_CONFIG.roles.pm, skills: ['team:security-checklist'] };
      const o = buildQueryOptions({ ...base, role: 'pm', config });
      expect(o.tools).toContain('Skill');
      const hook = o.hooks?.PreToolUse?.[0].hooks[0];
      expect(hook).toBeDefined();
      const signal = new AbortController().signal;

      const skillResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: {} } as never,
        undefined,
        { signal },
      );
      expect((skillResult as any).hookSpecificOutput).toBeUndefined();
    });

    it('qa role: Write to src denied, Write to tests allowed (testPathPatterns wired)', async () => {
      const o = buildQueryOptions({ ...base, role: 'qa', config: DEFAULT_CONFIG.roles.qa });
      const hook = o.hooks?.PreToolUse?.[0].hooks[0];
      expect(hook).toBeDefined();
      const signal = new AbortController().signal;

      // Write to src/a.ts -> denied
      const writeSourceResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: inside('src', 'a.ts') } } as never,
        undefined,
        { signal },
      );
      expect((writeSourceResult as any).hookSpecificOutput?.permissionDecision).toBe('deny');

      // Write to tests/a.test.ts -> allowed
      const writeTestResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: inside('tests', 'a.test.ts') } } as never,
        undefined,
        { signal },
      );
      expect((writeTestResult as any).hookSpecificOutput).toBeUndefined();
    });

    it('backend role: Write to src allowed, Write outside denied, Read in skillsDir allowed, Read outside both denied', async () => {
      const o = buildQueryOptions({ ...base, role: 'backend', config: DEFAULT_CONFIG.roles.backend });
      const hook = o.hooks?.PreToolUse?.[0].hooks[0];
      expect(hook).toBeDefined();
      const signal = new AbortController().signal;

      // Write to src/a.ts -> allowed
      const writeInSrcResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: inside('src', 'a.ts') } } as never,
        undefined,
        { signal },
      );
      expect((writeInSrcResult as any).hookSpecificOutput).toBeUndefined();

      // Write outside projectDir -> denied
      const writeOutsideResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: outside } } as never,
        undefined,
        { signal },
      );
      expect((writeOutsideResult as any).hookSpecificOutput?.permissionDecision).toBe('deny');

      // Read inside skillsDir -> allowed
      const readSkillsResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: inSkillsDir('x', 'SKILL.md') } } as never,
        undefined,
        { signal },
      );
      expect((readSkillsResult as any).hookSpecificOutput).toBeUndefined();

      // Read outside both projectDir and skillsDir -> denied
      const readOutsideResult = await hook!(
        { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: outside } } as never,
        undefined,
        { signal },
      );
      expect((readOutsideResult as any).hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  // Safety settings for every role
  describe('Safety settings for all roles', () => {
    for (const role of ROLE_NAMES) {
      it(`${role}: permissionMode=dontAsk, settingSources=[project], strictMcpConfig=true, CLAUDE_CODE_DISABLE_AUTO_MEMORY=1, hooks present, skills=[]`, () => {
        const o = buildQueryOptions({ ...base, role, config: DEFAULT_CONFIG.roles[role] });
        expect(o.permissionMode).toBe('dontAsk');
        expect(o.settingSources).toEqual(['project']);
        expect(o.strictMcpConfig).toBe(true);
        expect(o.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
        expect(o.hooks?.PreToolUse).toHaveLength(1);
        expect(o.skills).toEqual([]);
      });
    }
  });

  // Immutability tests
  describe('Immutability', () => {
    it('allowedTools is a new array, not config.allowedTools', () => {
      const config = DEFAULT_CONFIG.roles.backend;
      const o = buildQueryOptions({ ...base, role: 'backend', config });
      expect(o.allowedTools).not.toBe(config.allowedTools);
      expect(o.allowedTools).toEqual(config.allowedTools);
    });

    it('skills is a new array, not config.skills', () => {
      const config = DEFAULT_CONFIG.roles.backend;
      const o = buildQueryOptions({ ...base, role: 'backend', config });
      expect(o.skills).not.toBe(config.skills);
      expect(o.skills).toEqual(config.skills);
    });

    it('tools is a new array in no-skill case', () => {
      const config = DEFAULT_CONFIG.roles.pm;
      const o = buildQueryOptions({ ...base, role: 'pm', config });
      expect(o.tools).not.toBe(config.tools);
    });
  });

  // Model assignment test
  describe('Model assignment', () => {
    it('planning gets model claude-opus-5', () => {
      const o = buildQueryOptions({ ...base, role: 'planning', config: DEFAULT_CONFIG.roles.planning });
      expect(o.model).toBe('claude-opus-5');
    });
  });

  // Skill deduplication test
  describe('Skill deduplication', () => {
    it('when config.tools already contains Skill and skills are non-empty, exactly one Skill appears', () => {
      const config = {
        ...DEFAULT_CONFIG.roles.frontend,
        tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'Skill'],
        skills: ['team:frontend-conventions'],
      };
      const o = buildQueryOptions({ ...base, role: 'frontend', config });
      const skillCount = (o.tools as string[]).filter((t) => t === 'Skill').length;
      expect(skillCount).toBe(1);
    });
  });
});
