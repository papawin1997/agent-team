/**
 * ส่วนที่ 3: ติดตามโควตา subscription จาก rate_limit_event ของ SDK
 * (SDKRateLimitInfo ใน sdk.d.ts — เก็บเฉพาะ field ที่ใช้ ; type อื่นของ SDK ส่งเข้ามาได้เพราะเป็น structural)
 */
export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected';
  overageResetsAt?: number;
  isUsingOverage?: boolean;
  overageInUse?: boolean;
  /**
   * ไม่มีใน type ของ SDK 0.3.278 แต่ event จริงส่งมา: utilization ต่อประเภทโควตา (0–1)
   * ตัวอย่าง 2026-11-05: { five_hour: { utilization: 0.25, resetsAt }, seven_day: { utilization: 0.28, resetsAt } }
   */
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number } | undefined>;
}

export type QuotaAlert = { kind: 'rejected' | 'overage' | 'warning'; info: RateLimitInfo };

/**
 * กำลังใช้ extra usage ที่คิดเงินจริง — ไม่ดู overageStatus: ค่านั้นบอกแค่ว่า "ถ้าจะใช้" ได้ไหม
 * (event จริง: overageStatus "rejected" + overageDisabledReason "org_level_disabled" = ปิดไว้ ไม่ได้ใช้)
 */
export function usingOverage(info: RateLimitInfo): boolean {
  return info.overageInUse === true || info.isUsingOverage === true || info.rateLimitType === 'overage';
}

/** % ที่ใช้ไปของประเภทโควตาที่เตือน: ชั้นบนก่อน แล้วค่อยดู unifiedWindows */
function utilizationOf(info: RateLimitInfo): number | undefined {
  return info.utilization ?? (info.rateLimitType ? info.unifiedWindows?.[info.rateLimitType]?.utilization : undefined);
}

const warningKey = (info: RateLimitInfo): string => `${info.rateLimitType ?? '?'}|${info.resetsAt ?? '?'}`;

/** ใช้ร่วมกันทั้งรอบรัน: runner บันทึก event, QuotaGate ถามที่จุดปลอดภัย */
export class QuotaMonitor {
  private latest: RateLimitInfo | undefined;
  /** คำเตือนปกติที่ผู้ใช้ตอบ continue แล้ว (key = ประเภท|เวลารีเซ็ต) */
  private readonly continued = new Set<string>();
  private overageContinued = false;

  record(info: RateLimitInfo): void {
    this.latest = info;
  }

  get last(): RateLimitInfo | undefined {
    return this.latest;
  }

  isRejected(): boolean {
    return this.latest?.status === 'rejected';
  }

  /** สิ่งที่ต้องแจ้ง/ถามที่จุดปลอดภัยถัดไป (ไม่มี = เรียก agent ต่อได้เลย) */
  pending(): QuotaAlert | undefined {
    const info = this.latest;
    if (!info) return undefined;
    if (info.status === 'rejected') return { kind: 'rejected', info };
    if (usingOverage(info) && !this.overageContinued) return { kind: 'overage', info };
    if (info.status === 'allowed_warning' && !this.continued.has(warningKey(info))) return { kind: 'warning', info };
    return undefined;
  }

  /** ผู้ใช้เลือก continue */
  acknowledge(alert: QuotaAlert): void {
    if (alert.kind === 'overage') this.overageContinued = true;
    else if (alert.kind === 'warning') this.continued.add(warningKey(alert.info));
  }
}

const TYPE_LABEL: Record<string, string> = {
  five_hour: 'โควตา 5 ชม.',
  seven_day: 'โควตา 7 วัน',
  seven_day_opus: 'โควตา 7 วัน (Opus)',
  seven_day_sonnet: 'โควตา 7 วัน (Sonnet)',
  seven_day_overage_included: 'โควตา 7 วัน',
  overage: 'extra usage',
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** เวลาท้องถิ่น HH:MM (คนละวันกับ now = d/M HH:MM) ; รับได้ทั้งวินาทีและมิลลิวินาที */
function formatReset(value: number, now: Date): string {
  const d = new Date(value < 1e12 ? value * 1000 : value);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? time : `${d.getDate()}/${d.getMonth() + 1} ${time}`;
}

const percent = (u: number): number => Math.round(u > 1 ? u : u * 100);

export function formatQuotaAlert(alert: QuotaAlert, now: Date = new Date()): string {
  const { info } = alert;
  const label = TYPE_LABEL[info.rateLimitType ?? ''] ?? 'โควตา';
  const parts: string[] = [];
  if (alert.kind === 'rejected') parts.push(`โควตาเต็มแล้ว (${label})`);
  else if (alert.kind === 'overage') parts.push('⚠ กำลังใช้ extra usage (คิดเงินเพิ่ม)');
  else parts.push(`⚠ ${label}`);
  const used = utilizationOf(info);
  if (alert.kind === 'warning' && used !== undefined) parts.push(`ใช้ไป ${percent(used)}%`);
  const reset = alert.kind === 'overage' ? (info.overageResetsAt ?? info.resetsAt) : info.resetsAt;
  if (reset !== undefined) parts.push(`รีเซ็ต ${formatReset(reset, now)}`);
  return parts.join(' · ');
}
