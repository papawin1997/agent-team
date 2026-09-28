import { TEST_PATH_PATTERNS } from './config';
import type { RiskCategory } from './risk';

/** หมวดเสี่ยงของไฟล์: หมวดเดียวกับคำเสี่ยงใน requirements + infra/dependency ที่มีแต่ในระดับไฟล์ */
export type FileRiskCategory = RiskCategory | 'infra' | 'dependency';

export interface RiskyFile {
  file: string;
  category: FileRiskCategory;
}

/** ขอบของคำใน path: ต้นทาง / ท้ายทาง หรือ / _ . - เพื่อไม่ให้ "author" ถูกนับเป็น auth หรือ "keyboard" เป็น key */
const B = '(^|[/_.-])';
const E = '([/_.-]|$)';

/** เรียงจากเฉพาะเจาะจงไปทั่วไป หนึ่งไฟล์ได้หมวดแรกที่ตรง */
const RULES: readonly { category: FileRiskCategory; re: RegExp }[] = [
  { category: 'secret', re: new RegExp(`(^|/)\\.env(\\.|$)|${B}(secrets?|credentials?|keys?|tokens?)${E}|\\.(pem|key|p12|pfx)$`, 'i') },
  {
    category: 'auth',
    re: new RegExp(`${B}(auth|oauth|login|logout|signin|signup|session|sessions|jwt|passport|permission|permissions|rbac|acl|password|passwords)${E}`, 'i'),
  },
  { category: 'payment', re: new RegExp(`${B}(payment|payments|billing|checkout|stripe|paypal|invoice|invoices)${E}`, 'i') },
  { category: 'migration', re: /(^|\/)migrations?\/|\.sql$|(^|\/)schema\.prisma$|(^|\/)db\/schema\./i },
  { category: 'upload', re: new RegExp(`${B}(upload|uploads|uploader|multer)${E}`, 'i') },
  { category: 'network', re: new RegExp(`${B}(cors|webhook|webhooks|proxy)${E}|(^|/)nginx[^/]*\\.conf$|(^|/)\\.htaccess$`, 'i') },
  {
    category: 'infra',
    re: /(^|\/)dockerfile[^/]*$|(^|\/)(docker-)?compose[^/]*\.ya?ml$|(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)terraform\//i,
  },
  {
    category: 'dependency',
    re: /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|Gemfile(\.lock)?|composer\.json)$/i,
  },
];

const isTestFile = (file: string): boolean => TEST_PATH_PATTERNS.some((re) => re.test(file));

/** ไฟล์ที่แตะเรื่องเสี่ยง (ดูจาก path อย่างเดียว) ใช้ตัดสินว่า task ระดับ quick/standard ต้องให้ Security ตรวจไหม */
export function riskyFiles(paths: readonly string[]): RiskyFile[] {
  const seen = new Set<string>();
  const found: RiskyFile[] = [];
  for (const raw of paths) {
    const file = raw.replace(/\\/g, '/');
    if (seen.has(file) || isTestFile(file)) continue;
    seen.add(file);
    const rule = RULES.find((r) => r.re.test(file));
    if (rule) found.push({ file, category: rule.category });
  }
  return found;
}
