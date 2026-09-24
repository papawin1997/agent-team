import { describe, expect, it } from 'vitest';
import { formatDesign, formatRequirements } from '../src/format';
import { makeDesign, makeRequirements } from './helpers/builders';

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
