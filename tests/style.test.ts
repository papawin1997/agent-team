import { describe, expect, it } from 'vitest';
import { colorEnabled, plainText, renderMarkdown, styler, styleSay, stylePrompt } from '../src/style';

const s = styler(true);
const off = styler(false);

describe('plainText', () => {
  it('pm/advisor คงรูปแบบเดิม "\\n[PM] ...\\n" ส่วน kind อื่นคืนข้อความเดิม', () => {
    expect(plainText('สวัสดี', 'pm')).toBe('\n[PM] สวัสดี\n');
    expect(plainText('ตอบ', 'advisor')).toBe('\n[ADVISOR] ตอบ\n');
    expect(plainText('x', 'warn')).toBe('x');
    expect(plainText('x')).toBe('x');
  });
});

describe('colorEnabled', () => {
  it('ใส่สีเมื่อเป็น TTY', () => {
    expect(colorEnabled({ isTTY: true }, {})).toBe(true);
    expect(colorEnabled({ isTTY: false }, {})).toBe(false);
    expect(colorEnabled({}, {})).toBe(false);
  });
  it('NO_COLOR ปิดสีเสมอ แม้เป็น TTY หรือมี FORCE_COLOR', () => {
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: '1' })).toBe(false);
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(false);
    expect(colorEnabled({ isTTY: true }, { NO_COLOR: '' })).toBe(true);
  });
  it('FORCE_COLOR บังคับเปิดสีเมื่อไม่ใช่ TTY ยกเว้นค่า 0 หรือว่าง', () => {
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: '0' })).toBe(false);
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: '' })).toBe(false);
  });
});

describe('styler', () => {
  it('ปิดสี: คืนข้อความเดิม และ badge ไม่มี escape', () => {
    expect(off.bold('a')).toBe('a');
    expect(off.cyan('a')).toBe('a');
    expect(off.badge('PM', 'cyan')).toBe(' PM ');
  });
  it('เปิดสี: ครอบด้วย SGR และปิดด้วยรหัสที่ตรงกัน', () => {
    expect(s.bold('a')).toBe('\x1b[1ma\x1b[22m');
    expect(s.dim('a')).toBe('\x1b[2ma\x1b[22m');
    expect(s.red('a')).toBe('\x1b[31ma\x1b[39m');
    expect(s.cyan('a')).toBe('\x1b[36ma\x1b[39m');
    expect(s.badge('PM', 'cyan')).toBe('\x1b[1;30;46m PM \x1b[0m');
    expect(s.badge('ADVISOR', 'magenta')).toBe('\x1b[1;30;45m ADVISOR \x1b[0m');
  });
});

describe('renderMarkdown', () => {
  it('หัวข้อเป็นตัวหนาสีฟ้า bullet เป็น • และ inline code/bold', () => {
    const out = renderMarkdown('# สรุป\n- ใช้ `ExportService`\n* **สำคัญ**\nธรรมดา', s);
    expect(out.split('\n')).toEqual([
      s.bold(s.cyan('สรุป')),
      `• ใช้ ${s.yellow('ExportService')}`,
      `• ${s.bold('สำคัญ')}`,
      'ธรรมดา',
    ]);
  });
  it('บรรทัดใน code fence เป็นสีเหลืองและไม่แปลง bullet', () => {
    const out = renderMarkdown(['```ts', '- x', '```'].join('\n'), s);
    expect(out.split('\n')).toEqual([s.dim('```ts'), s.yellow('- x'), s.dim('```')]);
  });
});

describe('styleSay', () => {
  it('pm: แถบ PM สีฟ้า แล้วเนื้อหาเยื้อง 2 ช่อง', () => {
    expect(styleSay('# หัว\nเนื้อหา', 'pm', s)).toBe(
      `\n${s.badge('PM', 'cyan')}\n  ${s.bold(s.cyan('หัว'))}\n  เนื้อหา\n`,
    );
  });
  it('advisor: แถบ ADVISOR สีม่วง บรรทัดว่างไม่เติมช่องว่าง', () => {
    expect(styleSay('a\n\nb', 'advisor', s)).toBe(`\n${s.badge('ADVISOR', 'magenta')}\n  a\n\n  b\n`);
  });
  it('agent: tag ของ role มีสีประจำ PASS เขียว FAIL แดง', () => {
    expect(styleSay('[QA] t1: PASS (0 issues)', 'agent', s)).toBe(
      `${s.bold(s.yellow('[QA]'))} t1: ${s.green('PASS')} (0 issues)`,
    );
    expect(styleSay('[backend] ทำ task t1', 'agent', s)).toBe(`${s.bold(s.green('[backend]'))} ทำ task t1`);
    expect(styleSay('[Security] t1: FAIL', 'agent', s)).toBe(`${s.bold(s.red('[Security]'))} t1: ${s.red('FAIL')}`);
    expect(styleSay('[unknown] x', 'agent', s)).toBe(`${s.bold(s.cyan('[unknown]'))} x`);
  });
  it('system จาง, warn หนาเหลือง, error หนาแดง, success เขียว, ไม่มี kind = เดิม', () => {
    expect(styleSay('x', 'system', s)).toBe(s.dim('x'));
    expect(styleSay('x', 'warn', s)).toBe(s.bold(s.yellow('x')));
    expect(styleSay('x', 'error', s)).toBe(s.bold(s.red('x')));
    expect(styleSay('x', 'success', s)).toBe(s.green('x'));
    expect(styleSay('x', undefined, s)).toBe('x');
  });
  it('menu: เลข N) เป็นสีฟ้าตัวหนา', () => {
    expect(styleSay('โปรเจกต์:\n  1) a\n  2) b', 'menu', s)).toBe(
      `โปรเจกต์:\n  ${s.bold(s.cyan('1)'))} a\n  ${s.bold(s.cyan('2)'))} b`,
    );
  });
});

describe('stylePrompt', () => {
  it('บรรทัดแรกตัวหนา เมนูเลขฟ้า วงเล็บจาง และ > เขียว', () => {
    const out = stylePrompt('ยืนยันไหม?\n1) confirm (ยืนยัน)   2) revise (ขอแก้)\nหรือพิมพ์คำถาม\n> ', s);
    expect(out).toBe(
      [
        s.bold('ยืนยันไหม?'),
        `${s.bold(s.cyan('1)'))} confirm ${s.dim('(ยืนยัน)')}   ${s.bold(s.cyan('2)'))} revise ${s.dim('(ขอแก้)')}`,
        'หรือพิมพ์คำถาม',
        s.bold(s.green('> ')),
      ].join('\n'),
    );
  });
  it('prompt ที่มีแค่ "> " หรือไม่มี > ท้าย', () => {
    expect(stylePrompt('> ', s)).toBe(s.bold(s.green('> ')));
    expect(stylePrompt('q> ', s)).toBe(`${s.bold('q')}${s.bold(s.green('> '))}`);
    expect(stylePrompt('ไม่มีลูกศร', s)).toBe(s.bold('ไม่มีลูกศร'));
  });
  it('ปิดสีแล้วได้ข้อความเดิม', () => {
    const p = 'ยืนยันไหม?\n1) confirm (ยืนยัน)\n> ';
    expect(stylePrompt(p, off)).toBe(p);
  });
});
