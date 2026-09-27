import type { Requirements } from './schemas';

export type RiskCategory = 'auth' | 'secret' | 'payment' | 'delete' | 'migration' | 'sql' | 'upload' | 'shell' | 'network';

/** คำภาษาอังกฤษตรวจแบบทั้งคำ (ไม่สนตัวพิมพ์) ส่วนคำไทยตรวจแบบ substring เพราะภาษาไทยไม่มีช่องว่างระหว่างคำ */
const RULES: readonly { category: RiskCategory; en: RegExp; th: readonly string[] }[] = [
  {
    category: 'auth',
    en: /\b(auth|authn|authz|authentication|authorization|authenticate|login|log-in|logout|sign[- ]?in|sign[- ]?up|password|passwd|oauth|sso|jwt|session|permission|permissions|rbac|acl)\b/i,
    th: ['เข้าสู่ระบบ', 'ล็อกอิน', 'ล็อคอิน', 'รหัสผ่าน', 'สิทธิ์', 'ยืนยันตัวตน', 'สมัครสมาชิก'],
  },
  {
    category: 'secret',
    en: /(\b(secret|secrets|api[- _]?key|token|tokens|credential|credentials|private key)\b)|(^|\s)\.env\b/i,
    th: ['คีย์ลับ', 'รหัสลับ', 'โทเคน'],
  },
  {
    category: 'payment',
    en: /\b(payment|payments|billing|invoice|checkout|credit card|stripe|refund|pay)\b/i,
    th: ['ชำระเงิน', 'จ่ายเงิน', 'บัตรเครดิต', 'คืนเงิน', 'ใบแจ้งหนี้'],
  },
  {
    category: 'delete',
    en: /\b(drop table|drop database|truncate|purge|wipe|rm -rf|delete all|bulk delete)\b/i,
    th: ['ลบข้อมูลทั้งหมด', 'ลบทั้งหมด', 'ล้างข้อมูล', 'ลบข้อมูลผู้ใช้'],
  },
  {
    category: 'migration',
    en: /\b(migration|migrations|migrate|alter table|schema change)\b/i,
    th: ['ย้ายข้อมูล', 'เปลี่ยนโครงสร้างฐานข้อมูล'],
  },
  { category: 'sql', en: /\b(sql|raw query)\b/i, th: [] },
  { category: 'upload', en: /\b(upload|uploads|multipart)\b/i, th: ['อัปโหลด', 'อัพโหลด'] },
  {
    category: 'shell',
    en: /\b(exec|execsync|spawn|shell|subprocess|child_process|eval)\b/i,
    th: ['รันคำสั่ง', 'สั่งคำสั่ง'],
  },
  { category: 'network', en: /\b(cors|webhook|webhooks|ssrf|proxy)\b/i, th: [] },
];

/** หมวดงานเสี่ยงที่พบในข้อความ (ไม่ซ้ำ เรียงตาม RULES) — ใช้กันงานเสี่ยงหลุดเข้าโหมด quick */
export function riskFlags(text: string): RiskCategory[] {
  return RULES.filter((r) => r.en.test(text) || r.th.some((w) => text.includes(w))).map((r) => r.category);
}

/** ข้อความที่ต้องตรวจความเสี่ยง: ไม่รวม outOfScope เพราะเป็นสิ่งที่ตกลงว่าจะไม่ทำ */
export function riskText(
  requirements: Requirements,
  quickTask?: { title: string; description: string; acceptanceCriteria: string[] },
): string {
  const parts = [
    requirements.goal,
    ...requirements.features,
    ...requirements.constraints,
    ...requirements.acceptanceCriteria,
  ];
  if (quickTask) parts.push(quickTask.title, quickTask.description, ...quickTask.acceptanceCriteria);
  return parts.join('\n');
}
