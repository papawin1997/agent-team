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
