export class RoleRunError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly subtype?: string,
    /** session ที่ล้ม (ใช้ resume เพื่อกู้คืน) */
    readonly sessionId?: string,
  ) {
    super(message);
    this.name = 'RoleRunError';
  }
}

export class RoleOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleOutputError';
  }
}

/** หยุดงานเพราะโควตา (ผู้ใช้เลือก handoff หรือโควตาเต็ม) — phases ต้องปล่อยผ่านทุก catch */
export class QuotaStopError extends Error {
  /** ข้อความล่าสุดของผู้ใช้ที่ยังไม่ถึง agent (โหมด ask ใส่ให้ก่อนโยนต่อ) */
  pendingText?: string;

  constructor(
    readonly reason: 'handoff' | 'rejected',
    message: string,
  ) {
    super(message);
    this.name = 'QuotaStopError';
  }
}

/** ใช้บรรทัดแรกของ catch ที่กลืน error ของ agent: QuotaStopError ต้องหยุดงานเสมอ */
export function rethrowQuotaStop(e: unknown): void {
  if (e instanceof QuotaStopError) throw e;
}
