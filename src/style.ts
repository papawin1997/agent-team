/** ประเภทข้อความที่ส่งให้ UserIO.say — CliIO ใช้เลือกสี ส่วน headless/log/test ใช้ plainText */
export type SayKind = 'pm' | 'advisor' | 'agent' | 'system' | 'warn' | 'error' | 'success' | 'menu';

const BLOCK_LABEL: Partial<Record<SayKind, string>> = { pm: 'PM', advisor: 'ADVISOR' };

/** ข้อความแบบไม่มีสี (headless, log, test, output ที่ไม่ใช่ TTY) — pm/advisor คงรูปแบบเดิม "\n[PM] ...\n" */
export function plainText(text: string, kind?: SayKind): string {
  const label = kind === undefined ? undefined : BLOCK_LABEL[kind];
  return label ? `\n[${label}] ${text}\n` : text;
}

/** ใส่สีเมื่อเป็น TTY — NO_COLOR ปิดเสมอ, FORCE_COLOR (ไม่ใช่ 0) บังคับเปิด */
export function colorEnabled(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;
  return stream.isTTY === true;
}

type Paint = (text: string) => string;

export interface Styler {
  bold: Paint;
  dim: Paint;
  red: Paint;
  green: Paint;
  yellow: Paint;
  blue: Paint;
  brightBlue: Paint;
  magenta: Paint;
  cyan: Paint;
  /** แถบหัวข้อ: ตัวหนาสีดำบนพื้นสี */
  badge: (label: string, bg: 'cyan' | 'magenta') => string;
}

const BG = { cyan: 46, magenta: 45 } as const;

/** ชุดฟังก์ชันลงสี ANSI 16 สี — enabled=false คืนข้อความเดิมทุกฟังก์ชัน */
export function styler(enabled: boolean): Styler {
  const paint = (open: number, close: number): Paint =>
    enabled ? (text) => `\x1b[${open}m${text}\x1b[${close}m` : (text) => text;
  return {
    bold: paint(1, 22),
    dim: paint(2, 22),
    red: paint(31, 39),
    green: paint(32, 39),
    yellow: paint(33, 39),
    blue: paint(34, 39),
    brightBlue: paint(94, 39),
    magenta: paint(35, 39),
    cyan: paint(36, 39),
    badge: (label, bg) => (enabled ? `\x1b[1;30;${BG[bg]}m ${label} \x1b[0m` : ` ${label} `),
  };
}

function renderInline(line: string, s: Styler): string {
  return line
    .replace(/`([^`]+)`/g, (_m, code: string) => s.yellow(code))
    .replace(/\*\*([^*]+)\*\*/g, (_m, text: string) => s.bold(text));
}

/** markdown อย่างง่ายของ PM/advisor: หัวข้อ, bullet, **bold**, `code`, code fence */
export function renderMarkdown(text: string, s: Styler): string {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return s.dim(line);
      }
      if (inFence) return s.yellow(line);
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (heading) return s.bold(s.cyan(heading[1] ?? ''));
      const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
      if (bullet) return `${bullet[1] ?? ''}• ${renderInline(bullet[2] ?? '', s)}`;
      return renderInline(line, s);
    })
    .join('\n');
}

function renderBlock(text: string, label: string, bg: 'cyan' | 'magenta', s: Styler): string {
  const body = renderMarkdown(text.trim(), s)
    .split('\n')
    .map((line) => (line === '' ? '' : `  ${line}`))
    .join('\n');
  return `\n${s.badge(label, bg)}\n${body}\n`;
}

type TagColor = 'brightBlue' | 'magenta' | 'green' | 'yellow' | 'red' | 'cyan';
const TAG_COLOR: Record<string, TagColor> = {
  pm: 'cyan',
  planning: 'brightBlue',
  frontend: 'magenta',
  backend: 'green',
  qa: 'yellow',
  security: 'red',
  advisor: 'magenta',
};

function styleAgent(text: string, s: Styler): string {
  return text
    .replace(/^(\s*)\[([^\]]+)\]/, (_m, space: string, tag: string) => {
      const color = TAG_COLOR[tag.toLowerCase()] ?? 'cyan';
      return `${space}${s.bold(s[color](`[${tag}]`))}`;
    })
    .replace(/\bPASS\b/g, s.green('PASS'))
    .replace(/\bFAIL\b/g, s.red('FAIL'));
}

const MENU_ITEM = /(^|\s)(\d+\))/gm;
const MENU_LINE = /(^|\s)\d+\)\s/;

const styleMenuNumbers = (text: string, s: Styler): string =>
  text.replace(MENU_ITEM, (_m, space: string, n: string) => `${space}${s.bold(s.cyan(n))}`);

/** ลงสีข้อความของ say ตามประเภท */
export function styleSay(text: string, kind: SayKind | undefined, s: Styler): string {
  switch (kind) {
    case 'pm':
      return renderBlock(text, 'PM', 'cyan', s);
    case 'advisor':
      return renderBlock(text, 'ADVISOR', 'magenta', s);
    case 'agent':
      return styleAgent(text, s);
    case 'system':
      return s.dim(text);
    case 'warn':
      return s.bold(s.yellow(text));
    case 'error':
      return s.bold(s.red(text));
    case 'success':
      return s.green(text);
    case 'menu':
      return styleMenuNumbers(text, s);
    default:
      return text;
  }
}

/** ลงสีคำถามของ ask: บรรทัดแรกตัวหนา, บรรทัดเมนูเลขฟ้า + วงเล็บจาง, "> " ท้ายสุดเขียว */
export function stylePrompt(prompt: string, s: Styler): string {
  const match = /^([\s\S]*?)(> ?)$/.exec(prompt);
  const body = match ? (match[1] ?? '') : prompt;
  const tail = match ? (match[2] ?? '') : '';
  let first = true;
  const lines = body.split('\n').map((line) => {
    if (MENU_LINE.test(line)) return styleMenuNumbers(line, s).replace(/\([^)]*\)/g, (x) => s.dim(x));
    if (first && line.trim() !== '') {
      first = false;
      return s.bold(line);
    }
    return line;
  });
  return lines.join('\n') + (tail ? s.bold(s.green(tail)) : '');
}
