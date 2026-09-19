import * as path from 'node:path';
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import type { RoleName } from './config';

// All checks here are lexical (allowlist + blocking patterns). Paths are not resolved through
// realpath/symlinks/8.3 short names, and shell parsing is best-effort: this is NOT an OS sandbox.

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

// ---------------------------------------------------------------------------
// Bash: tokenizer
// ---------------------------------------------------------------------------

const SEPARATORS = new Set([';', '|', '&', '\n', '\r', '(', ')', '`']);
const ESCAPABLE = new Set(['"', "'", ' ', ';', '|', '&', '(', ')', '`']);

/** Split a command line into simple commands (lists of words), respecting quotes. */
function splitCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: string | null = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command.charAt(i);
    const next = command.charAt(i + 1);
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && (next === '"' || next === '\\')) word += command.charAt(++i);
      else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
    } else if (ch === '\\' && ESCAPABLE.has(next)) {
      word += command.charAt(++i);
      inWord = true;
    } else if (SEPARATORS.has(ch)) {
      endCommand();
    } else if (/\s/.test(ch)) {
      endWord();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

/** Bodies of `$(...)` and backtick substitutions outside single quotes (they run even in "..."). */
function substitutions(command: string): string[] {
  const found: string[] = [];
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command.charAt(i);
    if (quote === "'") {
      if (ch === "'") quote = null;
    } else if (ch === '\\') {
      i++;
    } else if (ch === '"') {
      quote = quote === '"' ? null : '"';
    } else if (ch === "'" && quote === null) {
      quote = "'";
    } else if (ch === '`') {
      const end = command.indexOf('`', i + 1);
      found.push(command.slice(i + 1, end < 0 ? undefined : end));
      i = end < 0 ? command.length : end;
    } else if (ch === '$' && command.charAt(i + 1) === '(') {
      let depth = 1;
      let j = i + 2;
      for (; j < command.length && depth > 0; j++) {
        if (command.charAt(j) === '(') depth++;
        else if (command.charAt(j) === ')') depth--;
      }
      found.push(command.slice(i + 2, depth === 0 ? j - 1 : j));
      i = j - 1;
    }
  }
  return found;
}

/** Executable identity: basename, lower-case, without .exe/.cmd/.bat/.com. */
const exeName = (word: string): string =>
  (word.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');

/** Non-option words of `args`; `valueOpts` are options that consume the next word. */
function positionals(args: readonly string[], valueOpts: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (valueOpts.has(arg)) i++;
    else if (!arg.startsWith('-')) out.push(arg);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bash: per-executable rules
// ---------------------------------------------------------------------------

const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn']);
const PKG_BLOCKED = new Set(['publish', 'login', 'adduser']);
const PKG_VALUE_OPTS = new Set(['-w', '--workspace', '--prefix', '-C', '--dir', '--filter', '-F', '--cwd', '--registry', '--userconfig', '--cache', '--loglevel', '--otp', '--tag']);
const DELETERS = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'ri', 'remove-item']);
const CMD_DANGEROUS_SWITCHES: Record<string, string> = { rmdir: 's', rd: 's', del: 'sfq', erase: 'sfq' };
const RM_LONG_OPTS = ['recursive', 'force', 'no-preserve-root'];
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd']);
const WRAPPERS = new Set(['env', 'command', 'exec', 'nohup', 'time', 'xargs', 'nice', 'timeout', 'start', 'call', 'builtin', 'setsid']);
const SHELL_KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until']);
/** Executables the guard has rules for; a wrapper (`env`, `xargs`...) is resolved to the first of these. */
const KNOWN = new Set(['git', 'sudo', 'eval', ...PKG_MANAGERS, ...DELETERS, ...SHELLS]);
const MAX_NESTING = 5;

function checkGit(args: readonly string[]): Verdict {
  const sub = positionals(args, GIT_VALUE_OPTS)[0];
  if (sub === undefined || ALLOWED_GIT.has(sub)) return OK;
  return deny(`git ${sub} ไม่อนุญาต (agent ใช้ git ได้เฉพาะคำสั่งอ่าน)`);
}

function checkPackageManager(exe: string, args: readonly string[]): Verdict {
  const [sub, next] = positionals(args, PKG_VALUE_OPTS);
  const target = (sub === 'npm' ? next : sub)?.toLowerCase(); // `yarn npm publish`
  if (target !== undefined && PKG_BLOCKED.has(target)) return deny(`คำสั่ง ${exe} ${target} ถูกบล็อก`);
  return OK;
}

/** rm short-option cluster containing r/R/f/F, or a (possibly abbreviated) long option. */
function isRmDangerousFlag(arg: string): boolean {
  if (/^-[a-zA-Z]*[rRfF]/.test(arg)) return true;
  const long = arg.startsWith('--') ? (arg.slice(2).split('=')[0] ?? '') : '';
  return long !== '' && RM_LONG_OPTS.some((o) => o.startsWith(long));
}

/** cmd.exe switches such as `/s`, `/q`, `/s/q`. */
function isCmdDangerousSwitch(exe: string, arg: string): boolean {
  if (!/^(\/[a-z])+$/i.test(arg)) return false;
  const bad = CMD_DANGEROUS_SWITCHES[exe] ?? '';
  return arg.toLowerCase().split('/').some((letter) => letter !== '' && bad.includes(letter));
}

/** PowerShell -Recurse, including its unambiguous abbreviations (-r, -rec, ...). */
function isPsRecurse(arg: string): boolean {
  const name = /^-([a-z]+)(?::.*)?$/i.exec(arg)?.[1];
  return name !== undefined && 'recurse'.startsWith(name.toLowerCase());
}

function checkDelete(exe: string, args: readonly string[]): Verdict {
  const dangerous = args.some(
    (arg) => (exe === 'rm' && isRmDangerousFlag(arg)) || isCmdDangerousSwitch(exe, arg) || isPsRecurse(arg),
  );
  return dangerous ? deny(`${exe} แบบ recursive/force ถูกบล็อก`) : OK;
}

/** `bash -c "<script>"`, `powershell -Command "<script>"`, `cmd /c <script>`: check the script too. */
function checkShell(args: readonly string[], depth: number): Verdict {
  const at = args.findIndex((arg) => /^(-[a-z]*c|-command|\/[ck])$/i.test(arg));
  return at < 0 ? OK : checkBash(args.slice(at + 1).join(' '), depth + 1);
}

function checkSegment(words: readonly string[], depth: number): Verdict {
  const start = words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w) && !SHELL_KEYWORDS.has(w));
  if (start < 0) return OK;
  const exe = exeName(words[start] ?? '');
  const args = words.slice(start + 1);
  if (WRAPPERS.has(exe)) {
    const inner = args.findIndex((w) => KNOWN.has(exeName(w)));
    return inner < 0 ? OK : checkSegment(args.slice(inner), depth);
  }
  if (exe === 'sudo') return deny('sudo ถูกบล็อก');
  if (exe === 'eval') return checkBash(args.join(' '), depth + 1);
  if (exe === 'git') return checkGit(args);
  if (PKG_MANAGERS.has(exe)) return checkPackageManager(exe, args);
  if (DELETERS.has(exe)) return checkDelete(exe, args);
  if (SHELLS.has(exe)) return checkShell(args, depth);
  return OK;
}

function checkBash(command: string, depth = 0): Verdict {
  if (depth > MAX_NESTING) return deny('คำสั่ง Bash ซ้อนลึกเกินไป');
  const parts = [
    ...splitCommands(command).map((words) => () => checkSegment(words, depth)),
    ...substitutions(command).map((inner) => () => checkBash(inner, depth + 1)),
  ];
  for (const run of parts) {
    const verdict = run();
    if (!verdict.ok) return verdict;
  }
  return OK;
}

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
  const readOnlyRole = ctx.role === 'pm' || ctx.role === 'planning';
  if (readOnlyRole && (WRITE_TOOLS.has(toolName) || toolName === 'Bash')) {
    return deny(`role ${ctx.role} เป็นแบบอ่านอย่างเดียว`);
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

export function createGuardHook(ctx: GuardContext): HookCallback {
  return async (input) => {
    try {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const pre = input as PreToolUseHookInput;
      if (typeof pre.tool_name !== 'string') throw new Error('missing tool_name');
      const verdict = checkToolUse(ctx, pre.tool_name, (pre.tool_input ?? {}) as Record<string, unknown>);
      return verdict.ok ? {} : denyOutput(verdict.reason);
    } catch (err) {
      // Fail closed: an unexpected guard failure must never let a tool call through.
      return denyOutput(`guard error: ${err instanceof Error ? err.message : 'unexpected failure'}`);
    }
  };
}
