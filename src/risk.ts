import type { Design, Requirements } from './schemas';

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

/** คำที่หมายถึง "ข้อมูล" ใช้ร่วมกับ "ลบ" + "ทุก"/"ทั้งหมด" กันหมวด delete จับงานแก้ไขทั่วไป (ดูหมายเหตุที่ thMatch ของ delete) */
const DATA_NOUNS_TH: readonly string[] = ['ข้อมูล', 'ผู้ใช้', 'ลูกค้า', 'บัญชี', 'ตาราง', 'ฐานข้อมูล'];

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
    // ไทย: ต้องมี "ทั้งหมด"/"ทุก" ตามหลัง "ลบ" แบบใกล้กัน (ไม่เกิน ~15 ตัวอักษร) และมีคำที่หมายถึงข้อมูลร่วมด้วย
    // "ล้างข้อมูล" ยังนับเป็น delete เสมอ
    // แก้ false positive จาก review รอบ 2: เดิมเช็คแค่ "ลบ" และ "ทั้งหมด"/"ทุก" เป็น substring แยกกันที่ไหนก็ได้ในข้อความ
    // ทำให้ประโยคที่ "ลบ" กับ "ทั้งหมด"/"ทุก" อยู่คนละบริบท/คนละประโยคย่อย เช่น
    // "เพิ่มปุ่มลบในหน้าผู้ใช้ ให้แสดงทุกหน้า" หรือ "แก้ปุ่มให้ทุกหน้าลบเงาออก" (ทุกอยู่ก่อนลบ) ถูกจับผิด
    // จึงเพิ่มเงื่อนไข proximity: "ทั้งหมด"/"ทุก" ต้องอยู่ "หลัง" ลบ และห่างไม่เกิน ~15 ตัวอักษร ถึงจะถือว่าพูดถึงสิ่งเดียวกัน
    // ("ลบ console.log ทุกไฟล์", "ลบ todo ได้ทุกรายการ" ยังไม่จับเพราะไม่มีคำที่หมายถึงข้อมูลอยู่ดี)
    thMatch: (text) =>
      (/ลบ[^\n]{0,15}?(?:ทั้งหมด|ทุก)/.test(text) && DATA_NOUNS_TH.some((w) => text.includes(w))) ||
      text.includes('ล้างข้อมูล'),
  },
  {
    category: 'migration',
    en: /\b(migrat\w*|alter table|schema change)\b/i,
    th: ['ย้ายข้อมูล', 'เปลี่ยนโครงสร้างฐานข้อมูล'],
  },
  {
    category: 'sql',
    // แก้ false negative จาก review: จำกัดความยาวช่องว่างระหว่าง select/update กับ from/set (เดิม <=8 ตัวอักษร)
    // ทำให้ query จริงที่มีรายชื่อคอลัมน์/ชื่อตารางยาวหลุด (เช่น "SELECT id, name, email FROM users") เปลี่ยนมาใช้
    // รูปแบบ token ของ SQL แทน: select ต้องตามด้วย "*" หรือรายชื่อคอลัมน์แบบ comma (>=2 คอลัมน์) หรือ aggregate
    // function (count/sum/avg/min/max ตามด้วย "(") แล้วค่อย from+ชื่อตาราง,
    // update ต้องตามด้วยชื่อตาราง (รองรับ identifier แบบ `backtick` และ "double-quote") แล้ว set แล้วมี "="
    // (เพื่อแยกจาก "update the header text and set color")
    // แก้ false negative จาก review รอบ 2: เพิ่มเคสคอลัมน์เดี่ยว (ไม่มี comma/*) ที่ตามด้วยชื่อตาราง +
    // where/join/order by/group by/limit เช่น "select name from users where id = 1" เพราะมี clause ต่อท้ายที่
    // บ่งชัดว่าเป็น SQL จริง ต่างจาก "select a color from the palette" ที่ column เป็นวลีหลายคำ (ไม่ใช่ token เดียว
    // ติดกับ from) จึงไม่เข้า pattern นี้อยู่แล้ว — เคสก้ำกึ่ง "select the best one from the list and order by price"
    // ก็ไม่จับด้วยเหตุผลเดียวกัน (คอลัมน์เป็นวลีหลายคำ) ตัดสินใจไม่จับเพื่อกันประโยคภาษาอังกฤษทั่วไปหลุดมาเป็น false positive
    // ตัดสินใจ: "select a from b" (คอลัมน์เดี่ยว ไม่มี comma/*, ไม่มี clause ต่อท้าย) ยังก้ำกึ่งเกินกว่าจะแยกจาก
    // ประโยคภาษาอังกฤษทั่วไปได้ จึงไม่จับ — ดูเทสต์ tests/risk.test.ts
    en: /\b(sql|raw query)\b|\bselect\s+(?:\*|(?:count|sum|avg|min|max)\s*\([^)]*\)|[\w.]+(?:\s*,\s*[\w.]+)+)\s+from\s+[\w.]+|\bselect\s+[\w.]+\s+from\s+[\w.]+\s+(?:where|join|order\s+by|group\s+by|limit)\b|\binsert\s+into\b|\bupdate\s+(?:`[^`]+`|"[^"]+"|[\w.]+)\s+set\s+(?:`[^`]+`|"[^"]+"|[\w.]+)\s*=|\bdelete\s+from\b/i,
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

/**
 * ข้อความของ design ที่ใช้ตรวจความเสี่ยงตอน REVIEW ของงาน standard (architecture + ทุก task title/description/
 * acceptanceCriteria + apiContract/dataModel) — apiContract/dataModel เป็น string อยู่แล้วใน DesignSchema
 * (src/schemas.ts) จึงไม่ต้อง JSON.stringify
 */
export function designRiskText(design: Design): string {
  const parts: string[] = [design.architecture];
  for (const task of design.tasks) parts.push(task.title, task.description, ...task.acceptanceCriteria);
  parts.push(design.apiContract, design.dataModel);
  return parts.join('\n');
}
