import * as path from 'node:path';
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import type { RoleName } from './config';
import { checkBash } from './guard-bash';

// All checks here are lexical (allowlist + blocking patterns). Paths are not resolved through
// realpath/symlinks/8.3 short names, and shell parsing (see guard-bash.ts) is best-effort:
// this is NOT an OS sandbox.

export interface GuardContext {
  role: RoleName;
  projectDir: string;
  skillsDir: string;
  testPathPatterns: readonly RegExp[];
  /** เรียกทุกครั้งที่ guard ปฏิเสธ (ใช้บันทึก log) ถ้าโยน error จะถูกกลืน ไม่กระทบการปฏิเสธ */
  onDeny?: (denial: { role: RoleName; tool: string; target?: string; reason: string }) => void;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };
const deny = (reason: string): Verdict => ({ ok: false, reason });

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const READ_ONLY_EXTRA_TOOLS = new Set(['Skill']);
const PROTECTED_DIRS = ['.git', '.agent-team', '.claude'];

// ---------------------------------------------------------------------------
// File tools
// ---------------------------------------------------------------------------

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function checkWrite(ctx: GuardContext, filePath: string): Verdict {
  const abs = path.resolve(ctx.projectDir, filePath);
  if (!isInside(ctx.projectDir, abs)) return deny(`เขียนนอกโฟลเดอร์โปรเจกต์ไม่ได้: ${filePath}`);
  if (PROTECTED_DIRS.some((d) => isInside(path.join(ctx.projectDir, d), abs))) {
    return deny(`โฟลเดอร์นี้ถูกป้องกัน: ${filePath}`);
  }
  if (ctx.role === 'qa') {
    const rel = path.relative(ctx.projectDir, abs).split(path.sep).join('/');
    if (!ctx.testPathPatterns.some((re) => re.test(rel))) {
      return deny(`QA เขียนได้เฉพาะไฟล์ test เท่านั้น: ${rel}`);
    }
  }
  return OK;
}

function checkRead(ctx: GuardContext, target: string): Verdict {
  if (!target) return OK;
  const abs = path.resolve(ctx.projectDir, target);
  if (isInside(ctx.projectDir, abs) || isInside(ctx.skillsDir, abs)) return OK;
  return deny(`อ่านนอกโฟลเดอร์โปรเจกต์ไม่ได้: ${target}`);
}

/** A glob may not climb out with `..`; an absolute one must have its fixed prefix inside an allowed root. */
function checkGlob(ctx: GuardContext, pattern: string): Verdict {
  const segments = pattern.split(/[\\/]/);
  if (segments.includes('..')) return deny(`glob ที่มี .. ไม่อนุญาต: ${pattern}`);
  if (!path.isAbsolute(pattern)) return OK;
  const magic = segments.findIndex((s) => /[*?[\]{}]/.test(s));
  const prefix = (magic < 0 ? segments : segments.slice(0, magic)).join('/');
  return checkRead(ctx, /^([A-Za-z]:)?$/.test(prefix) ? `${prefix}/` : prefix);
}

/** Validate an optional string-typed tool argument with `check`; a non-string value is malformed. */
function checkOptionalString(value: unknown, check: (s: string) => Verdict): Verdict {
  if (value === undefined || value === null) return OK;
  if (typeof value !== 'string') return deny('อาร์กิวเมนต์ของเครื่องมือไม่ใช่ข้อความ');
  return check(value);
}

function checkReadTool(ctx: GuardContext, toolName: string, input: Record<string, unknown>): Verdict {
  const globArg = toolName === 'Glob' ? input.pattern : toolName === 'Grep' ? input.glob : undefined;
  const checks: Array<[unknown, (s: string) => Verdict]> = [
    [input.file_path, (s) => checkRead(ctx, s)],
    [input.path, (s) => checkRead(ctx, s)],
    [globArg, (s) => checkGlob(ctx, s)],
  ];
  for (const [value, check] of checks) {
    const verdict = checkOptionalString(value, check);
    if (!verdict.ok) return verdict;
  }
  return OK;
}

export function checkToolUse(
  ctx: GuardContext,
  toolName: string,
  input: Record<string, unknown>,
): Verdict {
  const readOnlyRole = ctx.role === 'pm' || ctx.role === 'planning' || ctx.role === 'security';
  if (readOnlyRole) {
    if (READ_TOOLS.has(toolName)) return checkReadTool(ctx, toolName, input);
    if (READ_ONLY_EXTRA_TOOLS.has(toolName)) return OK;
    return deny(`role ${ctx.role} เป็นแบบอ่านอย่างเดียว ใช้ ${toolName} ไม่ได้`);
  }
  if (toolName === 'Bash') {
    return typeof input.command === 'string' ? checkBash(input.command) : deny('ไม่พบคำสั่ง Bash');
  }
  if (WRITE_TOOLS.has(toolName)) {
    const p = input.file_path ?? input.notebook_path;
    if (typeof p !== 'string' || p === '') return deny('ไม่พบ path ของไฟล์ที่จะเขียน');
    return checkWrite(ctx, p);
  }
  if (READ_TOOLS.has(toolName)) return checkReadTool(ctx, toolName, input);
  return OK;
}

const denyOutput = (reason: string) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse' as const,
    permissionDecision: 'deny' as const,
    permissionDecisionReason: reason,
  },
});

const TARGET_KEYS = ['command', 'file_path', 'notebook_path', 'path', 'pattern'];

function targetOf(input: Record<string, unknown>): string | undefined {
  for (const key of TARGET_KEYS) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export function createGuardHook(ctx: GuardContext): HookCallback {
  const deny$ = (tool: string, input: Record<string, unknown>, reason: string) => {
    try {
      ctx.onDeny?.({ role: ctx.role, tool, target: targetOf(input), reason });
    } catch {
      // log ล้มเหลวต้องไม่ทำให้การปฏิเสธหาย
    }
    return denyOutput(reason);
  };
  return async (input) => {
    let tool = 'unknown';
    let toolInput: Record<string, unknown> = {};
    try {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const pre = input as PreToolUseHookInput;
      if (typeof pre.tool_name !== 'string') throw new Error('missing tool_name');
      tool = pre.tool_name;
      toolInput = (pre.tool_input ?? {}) as Record<string, unknown>;
      const verdict = checkToolUse(ctx, tool, toolInput);
      return verdict.ok ? {} : deny$(tool, toolInput, verdict.reason);
    } catch (err) {
      // Fail closed: an unexpected guard failure must never let a tool call through.
      return deny$(tool, toolInput, `guard error: ${err instanceof Error ? err.message : 'unexpected failure'}`);
    }
  };
}
