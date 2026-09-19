import { describe, expect, it } from 'vitest';
import { formatRequirements } from '../src/format';
import { makeRequirements } from './helpers/builders';

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
