import { describe, expect, it } from 'vitest';
import { agentLabel, describeToolUse, ERASE_LINE, formatElapsed, Spinner } from '../src/activity';

describe('describeToolUse', () => {
  it.each([
    ['Read', { file_path: 'src/a.ts' }, 'อ่านไฟล์ src/a.ts'],
    ['Edit', { file_path: 'src/a.ts' }, 'แก้ไฟล์ src/a.ts'],
    ['MultiEdit', { file_path: 'src/a.ts' }, 'แก้ไฟล์ src/a.ts'],
    ['Write', { file_path: 'src/b.ts' }, 'แก้ไฟล์ src/b.ts'],
    ['Bash', { command: 'npm   test\n  -- --run' }, 'รันคำสั่ง npm test -- --run'],
    ['Grep', { pattern: 'createUser' }, 'ค้นหา createUser'],
    ['Glob', { pattern: 'src/**/*.ts' }, 'ค้นหา src/**/*.ts'],
    ['Skill', { skill: 'tdd' }, 'ใช้ skill tdd'],
    ['StructuredOutput', { verdict: 'PASS' }, 'สรุปผลลัพธ์'],
    ['WebFetch', { url: 'https://x' }, 'ใช้ tool WebFetch'],
    ['Read', undefined, 'อ่านไฟล์'],
    ['Bash', { command: '   ' }, 'รันคำสั่ง'],
  ])('%s %j -> %s', (name, input, expected) => {
    expect(describeToolUse(name, input)).toBe(expected);
  });

  it('path ยาวตัดส่วนหน้าทิ้ง เก็บชื่อไฟล์ท้ายไว้ (รวม 60 ตัวอักษร)', () => {
    const file = `${'a/'.repeat(50)}user.ts`;
    const out = describeToolUse('Read', { file_path: file });
    const shown = out.slice('อ่านไฟล์ '.length);
    expect(shown.startsWith('…')).toBe(true);
    expect(shown.endsWith('/user.ts')).toBe(true);
    expect(Array.from(shown)).toHaveLength(60);
  });

  it('คำสั่งยาวตัดส่วนท้ายทิ้ง (รวม 60 ตัวอักษร)', () => {
    const out = describeToolUse('Bash', { command: `echo ${'x'.repeat(100)}` });
    const shown = out.slice('รันคำสั่ง '.length);
    expect(shown.startsWith('echo ')).toBe(true);
    expect(shown.endsWith('…')).toBe(true);
    expect(Array.from(shown)).toHaveLength(60);
  });
});

describe('agentLabel', () => {
  it.each([
    ['pm', undefined, '[PM] กำลังคิด'],
    ['planning', undefined, '[Planning] กำลังออกแบบ'],
    ['backend', 'T2', '[backend] T2: กำลังทำงาน'],
    ['frontend', 'ui', '[frontend] ui: กำลังทำงาน'],
    ['qa', 'T2', '[QA] T2: กำลังตรวจ'],
    ['security', 'T2', '[Security] T2: กำลังตรวจความปลอดภัย'],
    ['security', undefined, '[Security] กำลังตรวจ design'],
  ] as const)('%s %s -> %s', (role, taskId, expected) => {
    expect(agentLabel(role, taskId)).toBe(expected);
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0m00s'],
    [999, '0m00s'],
    [83_000, '1m23s'],
    [3_600_000, '60m00s'],
  ])('%d -> %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });
});

describe('Spinner', () => {
  function setup(opts: { tty?: boolean; columns?: number } = {}) {
    const writes: string[] = [];
    let time = 0;
    let tick: (() => void) | undefined;
    const cleared: unknown[] = [];
    const spinner = new Spinner({
      output: {
        write: (s: string) => {
          writes.push(s);
          return true;
        },
      } as unknown as NodeJS.WritableStream,
      tty: opts.tty ?? true,
      columns: () => opts.columns,
      now: () => time,
      setInterval: (fn) => {
        tick = fn;
        return 'h';
      },
      clearInterval: (h) => {
        cleared.push(h);
        tick = undefined;
      },
    });
    const advance = (ms: number) => {
      time += ms;
      tick?.();
    };
    return { spinner, writes, advance, cleared, hasTimer: () => tick !== undefined };
  }

  it('terminal: วาดบรรทัดเดียวทับที่เดิม พร้อม frame เวลา และ detail', () => {
    const { spinner, writes, advance } = setup();
    spinner.start('[QA] T2: กำลังตรวจ');
    expect(writes.at(-1)).toBe(`${ERASE_LINE}⠋ [QA] T2: กำลังตรวจ 0m00s`);
    advance(83_000);
    expect(writes.at(-1)).toBe(`${ERASE_LINE}⠙ [QA] T2: กำลังตรวจ 1m23s`);
    spinner.update('อ่านไฟล์ a.ts');
    expect(writes.at(-1)).toBe(`${ERASE_LINE}⠙ [QA] T2: กำลังตรวจ 1m23s · อ่านไฟล์ a.ts`);
    expect(writes.join('')).not.toContain('\n');
    expect(spinner.active).toBe(true);
  });

  it('stop ลบบรรทัดและหยุด timer', () => {
    const { spinner, writes, advance, cleared, hasTimer } = setup();
    spinner.start('[PM] กำลังคิด');
    spinner.stop();
    expect(writes.at(-1)).toBe(ERASE_LINE);
    expect(cleared).toEqual(['h']);
    expect(hasTimer()).toBe(false);
    expect(spinner.active).toBe(false);
    const count = writes.length;
    advance(1000);
    spinner.update('อ่านไฟล์ a.ts');
    spinner.stop();
    expect(writes).toHaveLength(count);
  });

  it('ตัดบรรทัดไม่ให้เกินความกว้าง terminal - 1', () => {
    const { spinner, writes } = setup({ columns: 20 });
    spinner.start(`[backend] ${'ก'.repeat(50)}`);
    const line = writes.at(-1)!.slice(ERASE_LINE.length);
    expect(Array.from(line)).toHaveLength(19);
    expect(line.endsWith('…')).toBe(true);
  });

  it('clear ลบบรรทัดชั่วคราว redraw วาดกลับ และหลัง stop ทั้งสองไม่เขียนอะไร', () => {
    const { spinner, writes } = setup();
    spinner.start('[PM] กำลังคิด');
    spinner.clear();
    expect(writes.at(-1)).toBe(ERASE_LINE);
    spinner.clear();
    expect(writes.filter((w) => w === ERASE_LINE)).toHaveLength(1);
    spinner.redraw();
    expect(writes.at(-1)).toBe(`${ERASE_LINE}⠋ [PM] กำลังคิด 0m00s`);
    spinner.stop();
    const count = writes.length;
    spinner.redraw();
    spinner.clear();
    expect(writes).toHaveLength(count);
  });

  it('start ซ้อนระหว่างที่หมุนอยู่ หยุดตัวเก่าก่อน', () => {
    const { spinner, writes, cleared } = setup();
    spinner.start('[QA] T1: กำลังตรวจ');
    spinner.update('อ่านไฟล์ a.ts');
    spinner.start('[Security] T1: กำลังตรวจความปลอดภัย');
    expect(cleared).toEqual(['h']);
    expect(writes.at(-1)).toBe(`${ERASE_LINE}⠋ [Security] T1: กำลังตรวจความปลอดภัย 0m00s`);
  });

  it('ไม่ใช่ terminal: พิมพ์บรรทัดเดียวตอน start ไม่หมุน ไม่มี escape code', () => {
    const { spinner, writes, advance, hasTimer } = setup({ tty: false });
    spinner.start('[PM] กำลังคิด');
    spinner.update('อ่านไฟล์ a.ts');
    advance(5000);
    spinner.clear();
    spinner.redraw();
    spinner.stop();
    expect(writes).toEqual(['[PM] กำลังคิด...\n']);
    expect(hasTimer()).toBe(false);
  });
});
