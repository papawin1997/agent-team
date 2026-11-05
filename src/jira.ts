import type { JiraConfig } from './config';

// ตรรกะจาก tb-read-jira/scripts/fetch_jira.py (skill-ai-naja) พอร์ตเป็น TypeScript — โค้ดดึงเอง agent ไม่เห็น token

export const MAX_CARDS = 3;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * issue key ในข้อความ (key เปล่าหรือ URL https://<site>/browse/<KEY>) เฉพาะ project ใน projects — project อื่นไม่ดึงเลย
 * เลขเปล่าไม่นับ (กันจับผิดกับ "แก้ 3 ไฟล์") — ไม่ซ้ำ สูงสุด MAX_CARDS ใบตามลำดับที่พบ
 */
export function findIssueKeys(text: string, settings: JiraConfig): string[] {
  const pattern = new RegExp(
    `https?://${escapeRegExp(settings.site)}/browse/([A-Z][A-Z0-9]+-\\d+)|\\b([A-Z][A-Z0-9]+-\\d+)\\b`,
    'g',
  );
  const keys: string[] = [];
  for (const m of text.matchAll(pattern)) {
    const key = m[1] ?? m[2];
    if (!key || keys.includes(key)) continue;
    if (settings.projects.includes(key.split('-')[0] ?? '')) keys.push(key);
  }
  return keys.slice(0, MAX_CARDS);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(match: string, entity: string): string {
  if (entity.startsWith('#')) {
    const code =
      entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  }
  return ENTITIES[entity.toLowerCase()] ?? match;
}

/** renderedFields (HTML) → ข้อความอ่านได้: list เป็น "  - ", ช่องตารางเป็น "  | " */
export function htmlToText(raw: string | null | undefined): string {
  if (!raw) return '';
  const text = raw
    // ช่องว่างที่มีขึ้นบรรทัดใหม่ระหว่าง tag เป็นแค่การจัดหน้า HTML (ช่องว่างในบรรทัดเดียวกันเก็บไว้)
    .replace(/>[ \t]*\r?\n\s*</g, '><')
    .replace(/<li(\s[^>]*)?>/g, '\n  - ')
    .replace(/<\/li>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<p(\s[^>]*)?>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .replace(/<\/?(ol|ul|div|table|tbody|thead|tr)(\s[^>]*)?>/g, '')
    .replace(/<t[dh](\s[^>]*)?>/g, '\n  | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, decodeEntity);
  // ตัดเฉพาะบรรทัดว่างหัวท้าย (trim() จะกินย่อหน้าของ list ตัวแรก ทำให้ย่อหน้าไม่เท่ากัน)
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
}

export interface JiraAttachment {
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  type: string;
  status: string;
  priority: string;
  reporter: string;
  assignee: string;
  link: string;
  details: string;
  /** true = Key details ว่างทั้งหมด จึงใช้ description แทน */
  fromDescription: boolean;
  /** เฉพาะไฟล์แนบที่เป็นรูป */
  images: JiraAttachment[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const named = (v: unknown, field = 'name'): string => str(obj(v)[field]) || '-';

export function parseIssue(key: string, data: unknown, settings: JiraConfig): JiraIssue {
  const root = obj(data);
  const fields = obj(root.fields);
  const rendered = obj(root.renderedFields);
  const realKey = str(root.key) || key;
  const parts = settings.keyDetailsFields.map((f) => htmlToText(str(rendered[f]))).filter((p) => p !== '');
  const fromDescription = parts.length === 0;
  const attachments = Array.isArray(fields.attachment) ? fields.attachment.map(obj) : [];
  return {
    key: realKey,
    summary: str(fields.summary),
    type: named(fields.issuetype),
    status: named(fields.status),
    priority: named(fields.priority),
    reporter: named(fields.reporter, 'displayName'),
    assignee: named(fields.assignee, 'displayName'),
    link: `https://${settings.site}/browse/${realKey}`,
    details: fromDescription ? htmlToText(str(rendered.description)) : parts.join('\n\n'),
    fromDescription,
    images: attachments
      .filter((a) => str(a.mimeType).startsWith('image/'))
      .map((a) => ({
        filename: str(a.filename),
        mimeType: str(a.mimeType),
        size: typeof a.size === 'number' ? a.size : 0,
        url: str(a.content),
      })),
  };
}

/** การ์ดหนึ่งใบสำหรับแนบใน prompt (หัวข้อเป็นอังกฤษสำหรับ agent; เนื้อหาการ์ดคงตามต้นฉบับ) */
export function formatIssue(issue: JiraIssue, imagePaths: readonly string[]): string {
  const lines = [
    `# ${issue.key} — ${issue.summary}`,
    '',
    `- Type: ${issue.type}`,
    `- Status: ${issue.status}`,
    `- Priority: ${issue.priority}`,
    `- Reporter: ${issue.reporter}`,
    `- Assignee: ${issue.assignee}`,
    `- Link: ${issue.link}`,
    '',
    issue.fromDescription ? '## Description (Key details is empty)' : '## Key details',
    issue.details || '(empty)',
  ];
  if (imagePaths.length > 0) {
    lines.push('', '## Attached images (open them with Read)', ...imagePaths.map((p) => `- ${p}`));
  }
  return lines.join('\n');
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** รูปเดียวกับ globalThis.fetch แบบย่อ — เทสต์ฉีดตัวปลอมแทน */
export type HttpFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<HttpResponse>;

/** error ที่ข้อความแสดงผู้ใช้ได้ตรง ๆ (ไม่มี token/header) */
export class JiraError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JiraError';
  }
}

export interface JiraClientOptions {
  settings: JiraConfig;
  env: NodeJS.ProcessEnv;
  fetch: HttpFetch;
  /** ค่าเริ่มต้น 15 วินาที */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function authHeader(env: NodeJS.ProcessEnv): string {
  const email = env.JIRA_EMAIL;
  const token = env.JIRA_TOKEN;
  if (!email || !token) {
    throw new JiraError(
      'ยังไม่ได้ตั้ง JIRA_EMAIL / JIRA_TOKEN (สร้าง token ที่ https://id.atlassian.com/manage-profile/security/api-tokens แล้วตั้งเป็น environment variable ก่อนรัน agent-team)',
    );
  }
  return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
}

async function request(url: string, opts: JiraClientOptions, accept: string): Promise<HttpResponse> {
  const authorization = authHeader(opts.env);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await opts.fetch(url, {
      headers: { Authorization: authorization, Accept: accept },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new JiraError(`ไม่มีสิทธิ์อ่าน (HTTP ${res.status}) — ตรวจ JIRA_EMAIL / JIRA_TOKEN`, res.status);
    }
    if (res.status === 404) throw new JiraError('ไม่พบการ์ด หรือไม่มีสิทธิ์เห็น (HTTP 404)', 404);
    if (!res.ok) throw new JiraError(`Jira ตอบ HTTP ${res.status}`, res.status);
    return res;
  } catch (e) {
    if (e instanceof JiraError) throw e;
    if (controller.signal.aborted) throw new JiraError(`หมดเวลา ${Math.round(timeoutMs / 1000)} วินาที`);
    throw new JiraError(`เชื่อมต่อ Jira ไม่ได้ (${e instanceof Error ? e.message : String(e)})`);
  } finally {
    clearTimeout(timer);
  }
}

const BASE_FIELDS = ['summary', 'issuetype', 'status', 'priority', 'reporter', 'assignee', 'description', 'attachment'];

export async function fetchIssue(key: string, opts: JiraClientOptions): Promise<JiraIssue> {
  const fields = [...BASE_FIELDS, ...opts.settings.keyDetailsFields].join(',');
  const url = `https://${opts.settings.site}/rest/api/3/issue/${key}?expand=renderedFields&fields=${fields}`;
  const res = await request(url, opts, 'application/json');
  return parseIssue(key, await res.json(), opts.settings);
}

export async function downloadAttachment(url: string, opts: JiraClientOptions): Promise<Buffer> {
  const res = await request(url, opts, '*/*');
  return Buffer.from(await res.arrayBuffer());
}
