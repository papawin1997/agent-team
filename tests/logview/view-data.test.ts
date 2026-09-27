import { describe, expect, it } from 'vitest';
import { defaultRunIndex } from '../../src/logview/view-data';

const r = (calls: number, findings: number) => ({
  calls: new Array(calls).fill(0),
  findings: new Array(findings).fill(0),
});

describe('defaultRunIndex', () => {
  it('เลือกรอบล่าสุดที่เรียก agent (calls.length > 0)', () => {
    expect(defaultRunIndex([r(2, 0), r(0, 0), r(0, 0)])).toBe(0);
  });

  it('เลือกรอบล่าสุดที่มีปัญหา (findings.length > 0) แม้ไม่ได้เรียก agent', () => {
    expect(defaultRunIndex([r(2, 0), r(0, 1), r(0, 0)])).toBe(1);
  });

  it('รอบท้ายสุดมี call -> เลือกรอบนั้น', () => {
    expect(defaultRunIndex([r(2, 0), r(3, 0)])).toBe(1);
  });

  it('ไม่มีรอบไหนเรียก agent หรือมีปัญหาเลย -> fallback รอบสุดท้าย', () => {
    expect(defaultRunIndex([r(0, 0), r(0, 0)])).toBe(1);
  });

  it('ไม่มีรอบเลย -> -1', () => {
    expect(defaultRunIndex([])).toBe(-1);
  });
});
