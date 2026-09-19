import type { Requirements } from './schemas';

const list = (items: string[]): string =>
  items.length > 0 ? items.map((i) => `  - ${i}`).join('\n') : '  (ไม่มี)';

export function formatRequirements(r: Requirements): string {
  return [
    '--- Requirements ---',
    `เป้าหมาย: ${r.goal}`,
    'ฟีเจอร์:',
    list(r.features),
    'ข้อจำกัด:',
    list(r.constraints),
    'ไม่ทำ (out of scope):',
    list(r.outOfScope),
    'เกณฑ์ตรวจรับ:',
    list(r.acceptanceCriteria),
    '',
  ].join('\n');
}
