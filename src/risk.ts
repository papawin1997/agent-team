import type { Requirements } from './schemas';

export type RiskCategory = 'auth' | 'secret' | 'payment' | 'delete' | 'migration' | 'sql' | 'upload' | 'shell' | 'network';

type Rule = {
  category: RiskCategory;
  en: RegExp;
  /**
   * คำไทยตรวจแบบ substring เพราะภาษาไทยไม่มีช่องว่างระหว่างคำ (ไม่มีการตัดคำ/tokenize จริง)
   * ข้อควรระวัง: substring อาจไปพ้องกับคำอื่นที่ไม่เกี่ยวข้องโดยบังเอิญได้ (เช่นคำสั้น ๆ ที่เป็นส่วนหนึ่งของคำอื่น)
   * ถ้าคำเดี่ยว ๆ กว้างเกินไปจนเกิด false positive ให้ใช้ thMatch กำหนดเงื่อนไขแบบผสมแทน
   * (เช่น ต้องมีมากกว่าหนึ่ง substring ประกอบกันถึงจะถือว่าเข้าเงื่อนไข)
   */
  th: readonly string[];
  /** เงื่อนไขไทยแบบกำหนดเอง ใช้แทน th เมื่อ substring เดี่ยว ๆ ไม่พอ (ดูหมายเหตุที่ th) */
  thMatch?: (text: string) => boolean;
};

const RULES: readonly Rule[] = [
  {
    category: 'auth',
    en: /\b(auth|authn|authz|authentication|authorization|authenticat\w*|authoriz(?:e|ed|ing)|log[- ]?ins?|logged[- ]?in|log[- ]?out|sign[- ]?in|signed[- ]?in|sign[- ]?up|passwords?|passwd|pwd|oauth\d*|sso|jwt|permission|permissions|rbac|acl|session[- ]?id|session[- ]?cookie|session[- ]?token|session hijack(?:ing)?|login session)\b/i,
    th: ['เข้าสู่ระบบ', 'ล็อกอิน', 'ล็อคอิน', 'รหัสผ่าน', 'สิทธิ์', 'ยืนยันตัวตน', 'สมัครสมาชิก', 'การอนุญาต', 'พาสเวิร์ด'],
  },
  {
    category: 'secret',
    en: /\b(secret|secrets|api[- _]?keys?|credential|credentials|private key|access[- ]?tokens?|refresh[- ]?tokens?|api[- ]?tokens?|bearer[- ]?tokens?|auth[- ]?tokens?|personal access tokens?)\b|(^|\s)\.env\b/i,
    th: ['คีย์ลับ', 'รหัสลับ', 'โทเคน'],
  },
  {
    category: 'payment',
    en: /\b(payment|payments|billing|invoices?|checkout|credit card|stripe|refund|pay)\b/i,
    th: ['ชำระเงิน', 'จ่ายเงิน', 'บัตรเครดิต', 'คืนเงิน', 'ใบแจ้งหนี้'],
  },
  {
    category: 'delete',
    en: /\b(drop table|drop database|truncate|purge|wipe|rm -rf|delete all|delete everything|remove all|bulk delete)\b/i,
    th: [],
    // ไทย: ต้องมีทั้ง "ลบ" และ ("ทั้งหมด" หรือ "ทุก") เป็น substring แยกกัน (ไม่ต้องติดกัน) เพื่อไม่ให้ "ลบ" เดี่ยว ๆ
    // (เช่น เพิ่ม/ลบ todo) เข้าเงื่อนไข; "ล้างข้อมูล" ยังนับเป็น delete เสมอ
    thMatch: (text) =>
      (text.includes('ลบ') && (text.includes('ทั้งหมด') || text.includes('ทุก'))) || text.includes('ล้างข้อมูล'),
  },
  {
    category: 'migration',
    en: /\b(migrat\w*|alter table|schema change)\b/i,
    th: ['ย้ายข้อมูล', 'เปลี่ยนโครงสร้างฐานข้อมูล'],
  },
  {
    category: 'sql',
    // gap ระหว่าง select/update กับ from/set ต้องอยู่บรรทัดเดียวกันและสั้น (<=8 ตัวอักษร) กันไม่ให้จับประโยคภาษาอังกฤษ
    // ทั่วไปที่บังเอิญมีทั้งสองคำ (เช่น "select a color from the palette") ผิดเป็น SQL จริง
    en: /\b(sql|raw query)\b|\bselect\b[^\n]{0,8}?\bfrom\b|\binsert\s+into\b|\bupdate\b[^\n]{0,8}?\bset\b|\bdelete\s+from\b/i,
    th: [],
  },
  { category: 'upload', en: /\b(upload\w*|multipart)\b/i, th: ['อัปโหลด', 'อัพโหลด'] },
  {
    category: 'shell',
    en: /\b(exec|execsync|spawn|shell|subprocess|child_process|eval|popen|execut\w*)\b|os\.system/i,
    th: ['รันคำสั่ง', 'สั่งคำสั่ง'],
  },
  { category: 'network', en: /\b(cors|webhook|webhooks|ssrf|proxy)\b/i, th: [] },
];

/** หมวดงานเสี่ยงที่พบในข้อความ (ไม่ซ้ำ เรียงตาม RULES) — ใช้กันงานเสี่ยงหลุดเข้าโหมด quick */
export function riskFlags(text: string): RiskCategory[] {
  return RULES.filter(
    (r) => r.en.test(text) || (r.thMatch ? r.thMatch(text) : r.th.some((w) => text.includes(w))),
  ).map((r) => r.category);
}

const CATEGORY_ORDER: readonly RiskCategory[] = RULES.map((r) => r.category);

/** รวมหมวดเสี่ยงจากหลายแหล่ง (เช่น requirements ของ PM และข้อความดิบของ user) ไม่ซ้ำ เรียงตามลำดับหมวดเดิม */
export function mergeRiskFlags(...groups: readonly (readonly RiskCategory[])[]): RiskCategory[] {
  const found = new Set<RiskCategory>();
  for (const group of groups) for (const category of group) found.add(category);
  return CATEGORY_ORDER.filter((c) => found.has(c));
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
