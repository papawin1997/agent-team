import { describe, expect, it } from 'vitest';
import { codeChangedWarning, formatDesign, formatJobSummary, formatRequirements, jobTitle } from '../src/format';
import type { JobInfo } from '../src/jobs';
import { newState, type State } from '../src/state';
import { buildState, makeDesign, makeRequirements } from './helpers/builders';

describe('formatRequirements', () => {
  it('contains all section headings', () => {
    const req = makeRequirements();
    const formatted = formatRequirements(req);
    expect(formatted).toContain('--- Requirements ---');
    expect(formatted).toContain('เป้าหมาย:');
    expect(formatted).toContain('ฟีเจอร์:');
    expect(formatted).toContain('ข้อจำกัด:');
    expect(formatted).toContain('ไม่ทำ (out of scope):');
    expect(formatted).toContain('เกณฑ์ตรวจรับ:');
  });

  it('includes goal', () => {
    const req = makeRequirements();
    const formatted = formatRequirements(req);
    expect(formatted).toContain('เป้าหมาย: todo list');
  });

  it('lists items when array is not empty', () => {
    const req = makeRequirements();
    const formatted = formatRequirements(req);
    expect(formatted).toContain('  - เพิ่ม/ลบ todo');
    expect(formatted).toContain('  - เพิ่ม todo แล้วเห็นในรายการ');
  });

  it('renders empty arrays as (ไม่มี)', () => {
    const req = makeRequirements();
    const formatted = formatRequirements(req);
    expect(formatted).toContain('ข้อจำกัด:\n  (ไม่มี)');
    expect(formatted).toContain('ไม่ทำ (out of scope):\n  (ไม่มี)');
  });

  it('renders non-empty array without (ไม่มี)', () => {
    const req = makeRequirements();
    const formatted = formatRequirements(req);
    const constraintsLine = formatted.split('\n').indexOf('ข้อจำกัด:');
    const nextLine = formatted.split('\n')[constraintsLine + 1];
    expect(nextLine).toBe('  (ไม่มี)');
  });
});

describe('formatDesign', () => {
  it('แสดงหัวข้อและ task list', () => {
    const formatted = formatDesign(makeDesign());
    expect(formatted).toContain('--- Design ---');
    expect(formatted).toContain('[backend] api: task api');
  });

  it('แสดง security notes เมื่อมี', () => {
    const design = { ...makeDesign(), securityNotes: ['เก็บ password แบบ hash'] };
    expect(formatDesign(design)).toContain('เก็บ password แบบ hash');
  });

  it('แสดง (ไม่มี) เมื่อ security ตรวจแล้วไม่พบปัญหา (securityNotes: [])', () => {
    const design = { ...makeDesign(), securityNotes: [] };
    expect(formatDesign(design)).toContain('ข้อควรระวังด้านความปลอดภัย (Security):\n  (ไม่มี)');
  });

  it('แสดงข้อความตรวจไม่สำเร็จ เมื่อ securityNotes เป็น undefined', () => {
    expect(formatDesign(makeDesign())).toContain(
      'ข้อควรระวังด้านความปลอดภัย (Security):\n  (Security ตรวจไม่สำเร็จ',
    );
  });
});

const lastRun = new Date(2026, 8, 24, 14, 10);
const jobOf = (id: string, state: State, updatedAt = lastRun, lock?: JobInfo['lock']): JobInfo =>
  lock ? { id, state, updatedAt, lock } : { id, state, updatedAt };

describe('jobTitle', () => {
  it('ใช้ requirements.goal ก่อน title', () => {
    const s = buildState();
    s.title = 'ข้อความแรก';
    expect(jobTitle(s)).toBe('todo list');
  });

  it('ไม่มี requirements ใช้ title', () => {
    const s = newState();
    s.title = 'อยากได้ blog';
    expect(jobTitle(s)).toBe('อยากได้ blog');
  });

  it('ไม่มีทั้งคู่ใช้ข้อความ fallback', () => {
    expect(jobTitle(newState())).toBe('(ยังคุย requirements ไม่เสร็จ)');
  });
});

describe('formatJobSummary', () => {
  it('แสดงเลข ชื่อ เฟส ความคืบหน้า และเวลารันล่าสุด', () => {
    const s = buildState();
    s.progress.api = { ...s.progress.api!, done: true, rounds: 1 };
    s.progress.ui = { ...s.progress.ui!, rounds: 3 };
    expect(formatJobSummary(jobOf('a', s), 1)).toBe(
      '  1) "todo list" — เฟส BUILD (สร้างงาน/QA), เสร็จ 1/2 task (กำลังทำ ui: QA รอบ 3/5) · รันล่าสุด 2026-09-24 14:10',
    );
  });

  it('ยังไม่มี design ไม่แสดงความคืบหน้า', () => {
    const s = newState();
    s.title = 'blog';
    expect(formatJobSummary(jobOf('a', s), 2)).toBe(
      '  2) "blog" — เฟส REQUIREMENTS (คุย requirements กับ PM) · รันล่าสุด 2026-09-24 14:10',
    );
  });

  it('มี design แต่ยังไม่มีรอบ ไม่แสดง "กำลังทำ"', () => {
    const s = buildState();
    s.phase = 'REVIEW';
    expect(formatJobSummary(jobOf('a', s), 1)).toContain('เฟส REVIEW (รอยืนยัน design), เสร็จ 0/2 task · รันล่าสุด');
  });

  it('แสดงสถานะ lock และคำเตือนบรรทัดถัดไป', () => {
    const lock = { pid: 4120, startedAt: new Date(2026, 8, 25, 9, 12).toISOString() };
    const text = formatJobSummary(jobOf('a', buildState(), lastRun, lock), 1, '⚠ เตือน');
    const [line, warning] = text.split('\n');
    expect(line).toContain('· รันล่าสุด 2026-09-24 14:10 (กำลังรันอยู่ pid 4120 ตั้งแต่ 09:12)');
    expect(warning).toBe('     ⚠ เตือน');
  });
});

describe('codeChangedWarning', () => {
  const me = jobOf('me', buildState());
  const other = (id: string, title: string, lastBuild?: Date): JobInfo => {
    const s = newState();
    s.title = title;
    if (lastBuild) s.lastBuildAt = lastBuild.toISOString();
    return jobOf(id, s, new Date(2026, 8, 25, 12, 0));
  };

  it('งานอื่นแค่คุยกับ PM (ไม่มี lastBuildAt) ไม่เตือน', () => {
    expect(codeChangedWarning(me, [me, other('y', 'แค่คุย')])).toBeUndefined();
  });

  it('lastBuildAt ของงานอื่นเก่ากว่า updatedAt ของงานนี้ ไม่เตือน', () => {
    expect(codeChangedWarning(me, [me, other('y', 'เก่า', new Date(2026, 8, 23))])).toBeUndefined();
  });

  it('งานอื่นแก้โค้ดหลังจากนี้ -> เตือนพร้อมชื่องาน', () => {
    expect(codeChangedWarning(me, [me, other('y', 'หน้า report', new Date(2026, 8, 25, 9, 0))])).toBe(
      '⚠ งาน "หน้า report" แก้โค้ดหลังจากงานนี้ โค้ดอาจเปลี่ยนไปแล้ว',
    );
  });

  it('หลายงาน แสดงงานที่แก้ล่าสุดและจำนวนที่เหลือ', () => {
    const all = [me, other('y', 'ก่อน', new Date(2026, 8, 25, 8, 0)), other('z', 'หลัง', new Date(2026, 8, 25, 9, 0))];
    expect(codeChangedWarning(me, all)).toBe('⚠ งาน "หลัง" และอีก 1 งาน แก้โค้ดหลังจากงานนี้ โค้ดอาจเปลี่ยนไปแล้ว');
  });
});
