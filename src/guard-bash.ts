import type { Verdict } from './guard'; // type-only: no runtime import cycle with guard.ts

// Bash rules of the guard. Best-effort and purely lexical, NOT an OS sandbox: no variable expansion,
// no alias/function resolution, no realpath, and quoting inside `$(...)` / backtick bodies is not parsed.

const OK: Verdict = { ok: true };
const deny = (reason: string): Verdict => ({ ok: false, reason });

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const SEPARATORS = new Set([';', '|', '&', '\n', '\r', '(', ')']);
const ESCAPABLE = new Set(['"', "'", ' ', ';', '|', '&', '(', ')', '`']);

/**
 * A substitution opening at `i` (a backtick or `$(`): its body and the index just past it
 * (end of input when unterminated). Nested `$(` are balanced; nested backticks are not (lexical limit).
 */
function readSubstitution(command: string, i: number): { body: string; end: number } {
  if (command.charAt(i) === '`') {
    const close = command.indexOf('`', i + 1);
    return close < 0
      ? { body: command.slice(i + 1), end: command.length }
      : { body: command.slice(i + 1, close), end: close + 1 };
  }
  let depth = 1;
  let j = i + 2;
  for (; j < command.length && depth > 0; j++) {
    if (command.charAt(j) === '(') depth++;
    else if (command.charAt(j) === ')') depth--;
  }
  return { body: command.slice(i + 2, depth === 0 ? j - 1 : j), end: j };
}

/**
 * Split a command line into simple commands (lists of words), respecting quotes.
 * A `$(...)` or backtick substitution stays inside its word (it is not a separator, so it can never
 * shift which word is an option value); its body is checked separately by `substitutions`.
 */
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
    } else if (ch === '`' || (ch === '$' && next === '(')) {
      const { end } = readSubstitution(command, i);
      word += command.slice(i, end);
      inWord = true;
      i = end - 1;
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
    } else if (ch === '`' || (ch === '$' && command.charAt(i + 1) === '(')) {
      const { body, end } = readSubstitution(command, i);
      found.push(body);
      i = end - 1;
    }
  }
  return found;
}

/** Executable identity: basename, lower-case, without .exe/.cmd/.bat/.com. */
const exeName = (word: string): string =>
  (word.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');

/** Indexes of the non-option words of `args`; `valueOpts` are options that consume the next word. */
function positionalIndexes(args: readonly string[], valueOpts: ReadonlySet<string>): number[] {
  const out: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (valueOpts.has(arg)) i++;
    else if (!arg.startsWith('-')) out.push(i);
  }
  return out;
}

const positionals = (args: readonly string[], valueOpts: ReadonlySet<string>): string[] =>
  positionalIndexes(args, valueOpts).map((i) => args[i] ?? '');

// ---------------------------------------------------------------------------
// Per-executable rules
// ---------------------------------------------------------------------------

const ALLOWED_GIT = new Set(['status', 'diff', 'log', 'show', 'ls-files', 'rev-parse', 'blame']);
const GIT_VALUE_OPTS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--config-env',
  '--attr-source',
]);
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn']);
const PKG_BLOCKED = new Set(['publish', 'login', 'adduser']);
const PKG_VALUE_OPTS = new Set([
  '-w',
  '--workspace',
  '--prefix',
  '-C',
  '--dir',
  '--filter',
  '-F',
  '--cwd',
  '--registry',
  '--userconfig',
  '--cache',
  '--loglevel',
  '--otp',
  '--tag',
]);
/** `npm exec` / `pnpm dlx` ...: the following command is what actually runs. */
const PKG_RUN_SUBS = new Set(['exec', 'x', 'dlx']);
const RUNNERS = new Set(['npx', 'pnpx', 'bunx']);
const RUNNER_VALUE_OPTS = new Set([...PKG_VALUE_OPTS, '-p', '--package']);
const DELETERS = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'ri', 'remove-item']);
const CMD_DANGEROUS_SWITCHES: Record<string, string> = { rmdir: 's', rd: 's', del: 'sfq', erase: 'sfq' };
const RM_LONG_OPTS = ['recursive', 'force', 'no-preserve-root'];
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd']);
const WRAPPERS = new Set([
  'env',
  'command',
  'exec',
  'nohup',
  'time',
  'xargs',
  'nice',
  'timeout',
  'start',
  'call',
  'builtin',
  'setsid',
]);
const SHELL_KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until']);
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
/** Executables the guard has rules for; a wrapper (`env`, `xargs`...) is resolved to the first of these. */
const KNOWN = new Set([
  'git',
  'sudo',
  'eval',
  'find',
  ...RUNNERS,
  ...PKG_MANAGERS,
  ...DELETERS,
  ...SHELLS,
]);
const MAX_NESTING = 5;

const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const REDIRECTION = /^\d*[<>]/;
const BARE_REDIRECTION = /^\d*[<>]+$/; // operator alone: its target is the next word

/**
 * Index of the executable word, skipping `VAR=x`, shell keywords, redirections (`>out`, `2>&1`
 * fragments: `&` splits `2>&1`, leaving a lone digit word) and the target of a bare operator (`> out`).
 */
function commandStart(words: readonly string[]): number {
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? '';
    if (REDIRECTION.test(word)) {
      if (BARE_REDIRECTION.test(word)) i++;
    } else if (!/^\d+$/.test(word) && !ASSIGNMENT.test(word) && !SHELL_KEYWORDS.has(word)) {
      return i;
    }
  }
  return -1;
}

function checkGit(args: readonly string[]): Verdict {
  const sub = positionals(args, GIT_VALUE_OPTS)[0];
  if (sub === undefined || ALLOWED_GIT.has(sub)) return OK;
  return deny(`git ${sub} ไม่อนุญาต (agent ใช้ git ได้เฉพาะคำสั่งอ่าน)`);
}

/** `npx <cmd>`, `npm exec -- <cmd>`, ...: skip the runner's own options, then check the command it runs. */
function checkRunner(args: readonly string[], depth: number): Verdict {
  let i = 0;
  for (; i < args.length && (args[i] ?? '').startsWith('-'); i++) {
    const opt = args[i] ?? '';
    if (opt === '-c' || opt === '--call') return checkCommandLine(args.slice(i + 1).join(' '), depth + 1);
    if (RUNNER_VALUE_OPTS.has(opt)) i++;
  }
  return checkSegment(args.slice(i), depth);
}

function checkPackageManager(exe: string, args: readonly string[], depth: number): Verdict {
  const at = positionalIndexes(args, PKG_VALUE_OPTS);
  const sub = args[at[0] ?? -1];
  const viaYarn = sub === 'npm'; // `yarn npm publish`
  const target = (viaYarn ? args[at[1] ?? -1] : sub)?.toLowerCase();
  if (target === undefined) return OK;
  if (PKG_BLOCKED.has(target)) return deny(`คำสั่ง ${exe} ${target} ถูกบล็อก`);
  if (!viaYarn && PKG_RUN_SUBS.has(target)) return checkRunner(args.slice((at[0] ?? 0) + 1), depth);
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
  return at < 0 ? OK : checkCommandLine(args.slice(at + 1).join(' '), depth + 1);
}

/** `find ... -exec <cmd> ... ;|+`: check every command it would run; `-delete` is refused outright. */
function checkFind(args: readonly string[], depth: number): Verdict {
  if (args.includes('-delete')) return deny('find -delete ถูกบล็อก');
  for (let i = 0; i < args.length; i++) {
    if (!FIND_EXEC.has(args[i] ?? '')) continue;
    const end = args.indexOf(';', i + 1); // an escaped `\;` reaches us as a plain `;` word
    const stop = end < 0 ? args.length : end;
    const verdict = checkSegment(args.slice(i + 1, stop), depth);
    if (!verdict.ok) return verdict;
    i = stop;
  }
  return OK;
}

function checkSegment(words: readonly string[], depth: number): Verdict {
  const start = commandStart(words);
  if (start < 0) return OK;
  const exe = exeName(words[start] ?? '');
  const args = words.slice(start + 1);
  if (WRAPPERS.has(exe)) {
    const inner = args.findIndex((w) => KNOWN.has(exeName(w)));
    return inner < 0 ? OK : checkSegment(args.slice(inner), depth);
  }
  if (exe === 'sudo') return deny('sudo ถูกบล็อก');
  if (exe === 'eval') return checkCommandLine(args.join(' '), depth + 1);
  if (exe === 'git') return checkGit(args);
  if (exe === 'find') return checkFind(args, depth);
  if (RUNNERS.has(exe)) return checkRunner(args, depth);
  if (PKG_MANAGERS.has(exe)) return checkPackageManager(exe, args, depth);
  if (DELETERS.has(exe)) return checkDelete(exe, args);
  if (SHELLS.has(exe)) return checkShell(args, depth);
  return OK;
}

function checkCommandLine(command: string, depth: number): Verdict {
  if (depth > MAX_NESTING) return deny('คำสั่ง Bash ซ้อนลึกเกินไป');
  const parts = [
    ...splitCommands(command).map((words) => () => checkSegment(words, depth)),
    ...substitutions(command).map((inner) => () => checkCommandLine(inner, depth + 1)),
  ];
  for (const run of parts) {
    const verdict = run();
    if (!verdict.ok) return verdict;
  }
  return OK;
}

export function checkBash(command: string): Verdict {
  return checkCommandLine(command, 0);
}
