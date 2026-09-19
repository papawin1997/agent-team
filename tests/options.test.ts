import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { buildQueryOptions } from '../src/options';

const projectDir = path.resolve('options-test-project');
const skillsPluginDir = path.resolve('options-test-skills');
const base = { projectDir, skillsPluginDir, systemPrompt: 'sys' };

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
});
