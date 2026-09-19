import * as path from 'node:path';
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import type { RoleName } from './config';

export interface GuardContext {
  role: RoleName;
  projectDir: string;
  skillsDir: string;
  testPathPatterns: readonly RegExp[];
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const OK: Verdict = { ok: true };
const deny = (reason: string): Verdict => ({ ok: false, reason });

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const ALLOWED_GIT = new Set(['status', 'diff', 'log', 'show', 'ls-files', 'rev-parse', 'blame']);
const PROTECTED_DIRS = ['.git', '.agent-team', '.claude'];

const DANGEROUS_BASH: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-[a-zA-Z]*[rRfF]/, reason: 'rm แบบ recursive/force ถูกบล็อก' },
  { pattern: /\brm\s+--(recursive|force)/, reason: 'rm แบบ recursive/force ถูกบล็อก' },
  { pattern: /\b(rmdir|rd)\s+\/s/i, reason: 'ลบโฟลเดอร์แบบ recursive ถูกบล็อก' },
  { pattern: /\bdel\s+.*\/[sfq]/i, reason: 'del แบบ force/recursive ถูกบล็อก' },
  { pattern: /Remove-Item\b.*-Recurse/i, reason: 'Remove-Item -Recurse ถูกบล็อก' },
  { pattern: /\bsudo\b/, reason: 'sudo ถูกบล็อก' },
  { pattern: /\bnpm\s+(publish|login|adduser)\b/, reason: 'คำสั่ง npm นี้ถูกบล็อก' },
];

const GIT_RE = /\bgit\s+(?:-[^\s]+\s+)*([a-z][a-z-]*)/g;

function checkBash(command: string): Verdict {
  for (const { pattern, reason } of DANGEROUS_BASH) {
    if (pattern.test(command)) return deny(reason);
  }
  for (const match of command.matchAll(GIT_RE)) {
    const sub = match[1] ?? '';
    if (!ALLOWED_GIT.has(sub)) {
      return deny(`git ${sub} ไม่อนุญาต (agent ใช้ git ได้เฉพาะคำสั่งอ่าน)`);
    }
  }
  return OK;
}

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

function checkRead(ctx: GuardContext, target: string | undefined): Verdict {
  if (!target) return OK;
  const abs = path.resolve(ctx.projectDir, target);
  if (isInside(ctx.projectDir, abs) || isInside(ctx.skillsDir, abs)) return OK;
  return deny(`อ่านนอกโฟลเดอร์โปรเจกต์ไม่ได้: ${target}`);
}

export function checkToolUse(
  ctx: GuardContext,
  toolName: string,
  input: Record<string, unknown>,
): Verdict {
  const readOnlyRole = ctx.role === 'pm' || ctx.role === 'planning';
  if (readOnlyRole && (WRITE_TOOLS.has(toolName) || toolName === 'Bash')) {
    return deny(`role ${ctx.role} เป็นแบบอ่านอย่างเดียว`);
  }
  if (toolName === 'Bash') return checkBash(String(input.command ?? ''));
  if (WRITE_TOOLS.has(toolName)) {
    const p = input.file_path ?? input.notebook_path;
    if (typeof p !== 'string' || p === '') return deny('ไม่พบ path ของไฟล์ที่จะเขียน');
    return checkWrite(ctx, p);
  }
  if (READ_TOOLS.has(toolName)) {
    const p = input.file_path ?? input.path;
    return checkRead(ctx, typeof p === 'string' ? p : undefined);
  }
  return OK;
}

export function createGuardHook(ctx: GuardContext): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const pre = input as PreToolUseHookInput;
    const verdict = checkToolUse(ctx, pre.tool_name, (pre.tool_input ?? {}) as Record<string, unknown>);
    if (verdict.ok) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        permissionDecision: 'deny' as const,
        permissionDecisionReason: verdict.reason,
      },
    };
  };
}
