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

describe('Bash tool input', () => {
  it('denies a Bash call whose command is not a string', () => {
    expect(allowed('backend', 'Bash', { command: 123 })).toBe(false);
  });
});

describe('pm, planning และ security อ่านอย่างเดียว', () => {
  it.each(['pm', 'planning', 'security'] as const)('%s เขียนหรือรัน Bash ไม่ได้', (role) => {
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

  it('เรียก onDeny พร้อม role / tool / เป้าหมาย / เหตุผล เมื่อปฏิเสธ (และไม่เรียกเมื่อผ่าน)', async () => {
    const denied: unknown[] = [];
    const hook = createGuardHook({ ...ctx('backend'), onDeny: (d) => denied.push(d) });
    await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } } as never,
      undefined,
      { signal },
    );
    await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } } as never,
      undefined,
      { signal },
    );
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ role: 'backend', tool: 'Bash', target: 'rm -rf /' });
    expect((denied[0] as { reason: string }).reason).not.toBe('');
  });

  it('onDeny ที่โยน error ต้องไม่ทำให้ guard เปิดทาง (ยัง deny อยู่)', async () => {
    const hook = createGuardHook({
      ...ctx('backend'),
      onDeny: () => {
        throw new Error('log failed');
      },
    });
    const out = (await hook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } } as never,
      undefined,
      { signal },
    )) as Out;
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('ไม่ยุ่งกับ event อื่น', async () => {
    const hook = createGuardHook(ctx('backend'));
    expect(await hook({ hook_event_name: 'PostToolUse' } as never, undefined, { signal })).toEqual({});
  });
});

describe('path checks: lexical edge cases', () => {
  it('QA: tests/../src/a.ts is not a test file', () => {
    expect(allowed('qa', 'Write', { file_path: 'tests/../src/a.ts' })).toBe(false);
    expect(allowed('qa', 'Write', { file_path: 'src/../tests/a.test.ts' })).toBe(true);
  });

  it('src/../.git/x is protected', () => {
    expect(allowed('backend', 'Write', { file_path: 'src/../.git/x' })).toBe(false);
  });

  it('sibling directories sharing a prefix are outside', () => {
    const evilProject = path.resolve(`${projectDir}-evil`, 'x.ts');
    const evilSkills = path.resolve(`${skillsDir}-evil`, 'x.md');
    expect(allowed('backend', 'Write', { file_path: evilProject })).toBe(false);
    expect(allowed('backend', 'Read', { file_path: evilProject })).toBe(false);
    expect(allowed('backend', 'Read', { file_path: evilSkills })).toBe(false);
  });

  it('NotebookEdit follows the write rules', () => {
    expect(allowed('backend', 'NotebookEdit', { notebook_path: 'nb/a.ipynb' })).toBe(true);
    expect(allowed('backend', 'NotebookEdit', { notebook_path: outside })).toBe(false);
    expect(allowed('backend', 'NotebookEdit', { notebook_path: '.git/a.ipynb' })).toBe(false);
    expect(allowed('backend', 'NotebookEdit', {})).toBe(false);
    expect(allowed('qa', 'NotebookEdit', { notebook_path: 'nb/a.ipynb' })).toBe(false);
    expect(allowed('qa', 'NotebookEdit', { notebook_path: 'tests/a.ipynb' })).toBe(true);
    expect(allowed('pm', 'NotebookEdit', { notebook_path: 'nb/a.ipynb' })).toBe(false);
  });
});

describe('Glob/Grep pattern checks (finding 7)', () => {
  const fwd = (p: string) => p.split(path.sep).join('/');

  it('denies Glob patterns that climb out with ..', () => {
    expect(allowed('frontend', 'Glob', { pattern: '../../**/*' })).toBe(false);
    expect(allowed('frontend', 'Glob', { pattern: 'src/../../**/*.ts' })).toBe(false);
    expect(allowed('frontend', 'Glob', { pattern: '**/../../x' })).toBe(false);
    expect(allowed('frontend', 'Glob', { pattern: '..\\..\\**\\*' })).toBe(false);
  });

  it('denies absolute Glob patterns outside the allowed roots', () => {
    const elsewhere = path.resolve(projectDir, '..', 'elsewhere');
    expect(allowed('frontend', 'Glob', { pattern: `${fwd(elsewhere)}/**/*.ts` })).toBe(false);
    expect(allowed('frontend', 'Glob', { pattern: `${elsewhere}${path.sep}**` })).toBe(false);
    expect(allowed('frontend', 'Glob', { pattern: '/etc/**' })).toBe(false);
    expect(allowed('frontend', 'Glob', { pattern: `${fwd(projectDir)}-evil/**` })).toBe(false);
  });

  it('allows relative and in-root absolute Glob patterns', () => {
    expect(allowed('frontend', 'Glob', { pattern: 'src/**/*.ts' })).toBe(true);
    expect(allowed('frontend', 'Glob', { pattern: '**/*.{ts,tsx}' })).toBe(true);
    expect(allowed('frontend', 'Glob', { pattern: `${fwd(projectDir)}/src/**/*.ts` })).toBe(true);
    expect(allowed('frontend', 'Glob', { pattern: `${fwd(skillsDir)}/**/SKILL.md` })).toBe(true);
  });

  it('still checks the Glob/Grep path argument', () => {
    expect(allowed('frontend', 'Glob', { pattern: '**/*.ts', path: outside })).toBe(false);
    expect(allowed('frontend', 'Grep', { pattern: 'x', path: outside })).toBe(false);
  });

  it('inspects the Grep glob filter, but not its regex pattern', () => {
    expect(allowed('frontend', 'Grep', { pattern: 'x', glob: '../**' })).toBe(false);
    expect(allowed('frontend', 'Grep', { pattern: 'x', glob: '/etc/*' })).toBe(false);
    expect(allowed('frontend', 'Grep', { pattern: 'x', glob: '**/*.ts' })).toBe(true);
    expect(allowed('frontend', 'Grep', { pattern: '../../x' })).toBe(true);
  });

  it('denies non-string path arguments as malformed', () => {
    expect(allowed('frontend', 'Read', { file_path: 42 })).toBe(false);
    expect(allowed('frontend', 'Glob', { pattern: '**/*', path: {} })).toBe(false);
  });
});

describe('createGuardHook: fails closed (finding 10)', () => {
  const signal = new AbortController().signal;
  type Out = { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
  const run = async (input: unknown) =>
    (await createGuardHook(ctx('backend'))(input as never, undefined, { signal })) as Out;

  it('denies (does not throw) when reading tool_input throws', async () => {
    const out = await run({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      get tool_input(): never {
        throw new Error('boom');
      },
    });
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput?.permissionDecisionReason).toMatch(/guard/i);
  });

  it('denies when checkToolUse itself throws', async () => {
    const throwing = new Proxy(
      {},
      {
        get(): never {
          throw new Error('boom');
        },
      },
    );
    const out = await run({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: throwing });
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput?.permissionDecisionReason).toMatch(/guard/i);
  });

  it('denies when tool_name is missing', async () => {
    const out = await run({ hook_event_name: 'PreToolUse', tool_input: {} });
    expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});
