import { describe, expect, it } from 'vitest';
import { formatQuotaAlert, QuotaMonitor, type RateLimitInfo, usingOverage } from '../src/quota';

const now = new Date(2026, 10, 5, 12, 0);
const at = (h: number, m: number, day = 5) => new Date(2026, 10, day, h, m).getTime() / 1000;
const warning = (over: Partial<RateLimitInfo> = {}): RateLimitInfo => ({
  status: 'allowed_warning',
  rateLimitType: 'five_hour',
  utilization: 0.85,
  resetsAt: at(16, 30),
  ...over,
});

describe('QuotaMonitor', () => {
  it('ยังไม่มี event หรือ allowed ธรรมดา: ไม่มีอะไรค้าง', () => {
    const m = new QuotaMonitor();
    expect(m.pending()).toBeUndefined();
    m.record({ status: 'allowed', utilization: 0.2 });
    expect(m.pending()).toBeUndefined();
    expect(m.last).toEqual({ status: 'allowed', utilization: 0.2 });
  });

  it('allowed_warning: ค้างจน continue แล้วไม่ถามซ้ำในรอบเดียวกัน แต่ถามใหม่เมื่อ resetsAt เปลี่ยน', () => {
    const m = new QuotaMonitor();
    m.record(warning());
    const alert = m.pending();
    expect(alert?.kind).toBe('warning');
    m.acknowledge(alert!);
    m.record(warning({ utilization: 0.9 }));
    expect(m.pending()).toBeUndefined();
    m.record(warning({ resetsAt: at(21, 30) }));
    expect(m.pending()?.kind).toBe('warning');
  });

  it('เริ่มใช้ extra usage: ถามแม้เคย continue คำเตือนปกติ และถามครั้งเดียวต่อรอบ', () => {
    const m = new QuotaMonitor();
    m.record(warning());
    m.acknowledge(m.pending()!);
    m.record({ status: 'allowed', overageInUse: true });
    const alert = m.pending();
    expect(alert?.kind).toBe('overage');
    m.acknowledge(alert!);
    m.record({ status: 'allowed', overageInUse: true });
    expect(m.pending()).toBeUndefined();
  });

  it('rejected: ค้างเสมอ (continue ไม่ได้) และ isRejected = true', () => {
    const m = new QuotaMonitor();
    m.record({ status: 'rejected', resetsAt: at(16, 30) });
    expect(m.isRejected()).toBe(true);
    expect(m.pending()?.kind).toBe('rejected');
  });
});

describe('usingOverage', () => {
  it.each([
    [{ overageInUse: true }, true],
    [{ isUsingOverage: true }, true],
    [{ rateLimitType: 'overage' }, true],
    // overageStatus บอกแค่ว่า "ถ้าจะใช้" extra usage ได้หรือไม่ — ไม่ได้แปลว่ากำลังใช้
    [{ overageStatus: 'allowed_warning' as const }, false],
    [{ overageStatus: 'rejected' as const }, false],
    [{ overageStatus: 'allowed' as const }, false],
    [{}, false],
  ])('%j -> %s', (over, expected) => {
    expect(usingOverage({ status: 'allowed', ...over })).toBe(expected);
  });

  it('event จริง (2026-11-05): extra usage ถูกปิดระดับองค์กร = ไม่เตือน', () => {
    const m = new QuotaMonitor();
    m.record({
      status: 'allowed',
      resetsAt: 1793884200,
      rateLimitType: 'five_hour',
      overageStatus: 'rejected',
      isUsingOverage: false,
      unifiedWindows: {
        five_hour: { utilization: 0.25, resetsAt: 1793884200 },
        seven_day: { utilization: 0.28, resetsAt: 1793966400 },
      },
    });
    expect(m.pending()).toBeUndefined();
  });
});

describe('formatQuotaAlert', () => {
  it('warning: ประเภทภาษาไทย เปอร์เซ็นต์ และเวลารีเซ็ตท้องถิ่น', () => {
    expect(formatQuotaAlert({ kind: 'warning', info: warning() }, now)).toBe('⚠ โควตา 5 ชม. · ใช้ไป 85% · รีเซ็ต 16:30');
  });

  it('ไม่มี utilization ชั้นบน: ใช้ค่าจาก unifiedWindows ของประเภทโควตานั้น (รูปแบบ event จริง)', () => {
    const info = warning({
      utilization: undefined,
      unifiedWindows: { five_hour: { utilization: 0.87 }, seven_day: { utilization: 0.3 } },
    });
    expect(formatQuotaAlert({ kind: 'warning', info }, now)).toBe('⚠ โควตา 5 ชม. · ใช้ไป 87% · รีเซ็ต 16:30');
  });

  it('utilization เป็นเปอร์เซ็นต์อยู่แล้ว (> 1) และ resetsAt เป็นมิลลิวินาที', () => {
    const info = warning({ utilization: 92, resetsAt: at(16, 30) * 1000, rateLimitType: 'seven_day' });
    expect(formatQuotaAlert({ kind: 'warning', info }, now)).toBe('⚠ โควตา 7 วัน · ใช้ไป 92% · รีเซ็ต 16:30');
  });

  it('รีเซ็ตคนละวัน: มีวันที่ ; ไม่มีข้อมูล: ละส่วนนั้น', () => {
    expect(formatQuotaAlert({ kind: 'warning', info: warning({ resetsAt: at(9, 5, 7) }) }, now)).toContain('รีเซ็ต 7/11 09:05');
    expect(formatQuotaAlert({ kind: 'warning', info: { status: 'allowed_warning' } }, now)).toBe('⚠ โควตา');
  });

  it('overage บอกชัดว่าคิดเงินเพิ่ม ; rejected บอกว่าเต็มแล้ว', () => {
    expect(formatQuotaAlert({ kind: 'overage', info: { status: 'allowed', overageInUse: true } }, now)).toContain(
      'กำลังใช้ extra usage (คิดเงินเพิ่ม)',
    );
    expect(formatQuotaAlert({ kind: 'rejected', info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: at(16, 30) } }, now)).toBe(
      'โควตาเต็มแล้ว (โควตา 5 ชม.) · รีเซ็ต 16:30',
    );
  });
});
