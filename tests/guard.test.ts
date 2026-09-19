import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type RoleName, TEST_PATH_PATTERNS } from '../src/config';
import { checkToolUse, createGuardHook, type GuardContext } from '../src/guard';

const projectDir = path.resolve('guard-test-project');
const skillsDir = path.resolve('guard-test-skills');
const ctx = (role: RoleName): GuardContext => ({
  role,
  projectDir,
  skillsDir,
  testPathPatterns: TEST_PATH_PATTERNS,
});
const inside = (...p: string[]) => path.join(projectDir, ...p);
const outside = path.resolve(projectDir, '..', 'elsewhere', 'x.ts');

const allowed = (role: RoleName, tool: string, input: Record<string, unknown>) =>
  checkToolUse(ctx(role), tool, input).ok;

describe('Bash', () => {
  it('อนุญาตคำสั่งทั่วไป', () => {
    expect(allowed('backend', 'Bash', { command: 'npm test' })).toBe(true);
  });

  it.each([
    'rm -rf node_modules',
    'rm -fr build',
    'rm --recursive dist',
    'git push origin main',
    'git commit -m x',
    'git reset --hard',
    'npm publish',
    'sudo apt install x',
    'Remove-Item -Recurse -Force build',
  ])('บล็อก: %s', (command) => {
    expect(allowed('backend', 'Bash', { command })).toBe(false);
  });

  it.each(['git status', 'git diff --stat', 'git log -5'])('อนุญาต git อ่านอย่างเดียว: %s', (command) => {
    expect(allowed('backend', 'Bash', { command })).toBe(true);
  });
});

describe('เขียนไฟล์', () => {
  it('อนุญาตในโปรเจกต์ (พาธเต็มและพาธสัมพัทธ์)', () => {
    expect(allowed('frontend', 'Write', { file_path: inside('src', 'a.ts') })).toBe(true);
    expect(allowed('frontend', 'Edit', { file_path: 'src/a.ts' })).toBe(true);
  });

  it('บล็อกนอกโปรเจกต์', () => {
    expect(allowed('frontend', 'Write', { file_path: outside })).toBe(false);
    expect(allowed('frontend', 'Write', { file_path: '../x.ts' })).toBe(false);
  });

  it('บล็อกโฟลเดอร์ที่ป้องกัน', () => {
    for (const dir of ['.git', '.agent-team', '.claude']) {
      expect(allowed('backend', 'Write', { file_path: inside(dir, 'x') })).toBe(false);
    }
  });

  it('บล็อกเมื่อไม่มี file_path', () => {
    expect(allowed('backend', 'Write', {})).toBe(false);
  });
});

describe('QA เขียนได้เฉพาะไฟล์ test', () => {
  it.each(['tests/a.test.ts', 'src/a.test.ts', '__tests__/a.ts', 'pkg/test_x.py', 'pkg/x_test.go'])(
    'อนุญาต %s',
    (file) => {
      expect(allowed('qa', 'Write', { file_path: file })).toBe(true);
    },
  );

  it.each(['src/a.ts', 'package.json', 'README.md'])('บล็อก %s', (file) => {
    expect(allowed('qa', 'Edit', { file_path: file })).toBe(false);
  });
});

describe('pm และ planning อ่านอย่างเดียว', () => {
  it.each(['pm', 'planning'] as const)('%s เขียนหรือรัน Bash ไม่ได้', (role) => {
    expect(allowed(role, 'Write', { file_path: 'a.ts' })).toBe(false);
    expect(allowed(role, 'Bash', { command: 'ls' })).toBe(false);
    expect(allowed(role, 'Read', { file_path: 'a.ts' })).toBe(true);
  });
});

describe('อ่านไฟล์', () => {
  it('บล็อกการอ่านนอกโปรเจกต์', () => {
    expect(allowed('frontend', 'Read', { file_path: outside })).toBe(false);
    expect(allowed('frontend', 'Grep', { path: outside })).toBe(false);
  });

  it('อนุญาตอ่านในโฟลเดอร์ skills ของทีม', () => {
    expect(allowed('frontend', 'Read', { file_path: path.join(skillsDir, 'skills', 'x', 'SKILL.md') })).toBe(true);
  });

  it('Glob ที่ไม่ระบุ path = อนุญาต', () => {
    expect(allowed('frontend', 'Glob', { pattern: '**/*.ts' })).toBe(true);
  });
});

describe('createGuardHook', () => {
  const signal = new AbortController().signal;
  type Out = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };

  it('คืน deny เมื่อผิดกฎ', async () => {
    const hook = createGuardHook(ctx('backend'));
    const out = (await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } } as never,
      undefined,
      { signal },
    )) as Out;
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain('rm');
  });

  it('คืน {} เมื่อผ่าน', async () => {
    const hook = createGuardHook(ctx('backend'));
    const out = await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } } as never,
      undefined,
      { signal },
    );
    expect(out).toEqual({});
  });

  it('ไม่ยุ่งกับ event อื่น', async () => {
    const hook = createGuardHook(ctx('backend'));
    expect(await hook({ hook_event_name: 'PostToolUse' } as never, undefined, { signal })).toEqual({});
  });
});
