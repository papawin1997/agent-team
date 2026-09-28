import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';

/**
 * Windows: rename ทับไฟล์ที่อีก process เปิดอ่านอยู่ (เช่นคำสั่ง wait/status อ่าน state.json ทุกวินาที)
 * อาจได้ EPERM/EACCES/EBUSY ชั่วครู่ จึง retry สั้น ๆ ก่อนยอมแพ้
 */
export const RENAME_RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);
export const RENAME_RETRIES = 10;
export const RENAME_RETRY_MS = 20;

const isRetryable = (e: unknown): boolean => RENAME_RETRY_CODES.has((e as NodeJS.ErrnoException).code ?? '');

export interface RenameRetryOptions {
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

/** rename from → to พร้อม retry; ล้มจริงจะลบ from (ไฟล์ชั่วคราว) แล้วโยน error เดิม */
export async function renameWithRetry(from: string, to: string, opts: RenameRetryOptions = {}): Promise<void> {
  const rename = opts.rename ?? fsp.rename;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      if (!isRetryable(e) || attempt >= RENAME_RETRIES) {
        await fsp.rm(from, { force: true }).catch(() => {});
        throw e;
      }
      await sleep(RENAME_RETRY_MS);
    }
  }
}

export interface RenameRetrySyncOptions {
  rename?: (from: string, to: string) => void;
  sleep?: (ms: number) => void;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** renameWithRetry แบบ sync (writeJsonAtomic ถูกเรียกจาก signal handler / timer ที่ต้องเสร็จทันที) */
export function renameWithRetrySync(from: string, to: string, opts: RenameRetrySyncOptions = {}): void {
  const rename = opts.rename ?? fs.renameSync;
  const sleep = opts.sleep ?? sleepSync;
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (e) {
      if (!isRetryable(e) || attempt >= RENAME_RETRIES) {
        try {
          fs.rmSync(from, { force: true });
        } catch {
          // ลบไฟล์ชั่วคราวไม่ได้ก็ปล่อยไว้ error หลักสำคัญกว่า
        }
        throw e;
      }
      sleep(RENAME_RETRY_MS);
    }
  }
}
