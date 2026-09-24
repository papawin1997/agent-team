import type { Design, Requirements } from './schemas';

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

export function formatDesign(d: Design): string {
  const tasks = d.tasks
    .map((t) => {
      const after = t.dependsOn.length > 0 ? ` (ต้องทำหลัง ${t.dependsOn.join(', ')})` : '';
      return `  - [${t.owner}] ${t.id}: ${t.title}${after}`;
    })
    .join('\n');
  return [
    '--- Design ---',
    `ภาพรวม: ${d.overview}`,
    `สถาปัตยกรรม: ${d.architecture}`,
    `API contract:\n${d.apiContract}`,
    `Data model:\n${d.dataModel}`,
    'Tasks:',
    tasks,
    'ข้อควรระวังด้านความปลอดภัย (Security):',
    list(d.securityNotes ?? []),
    '',
  ].join('\n');
}
