import type { Deps } from './deps';
import { nullLogger } from './logger';
import type { RiskCategory } from './risk';
import type { Level } from './schemas';

/** บันทึก log เดียวกันทุกจุดที่ตัดสินระดับงาน (quick/full) — ใช้ร่วมกันระหว่าง requirements.ts และ build.ts */
export function logLevelDecided(
  deps: Deps,
  level: Level,
  by: 'pm' | 'user',
  reason: string | undefined,
  flags: readonly RiskCategory[],
): void {
  (deps.log ?? nullLogger).log('INFO', 'level.decided', { level, by, reason, riskFlags: flags });
}
