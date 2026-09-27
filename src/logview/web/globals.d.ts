// ชนิดข้อมูล global ที่ใช้ร่วมกันระหว่าง list.js และ page.js (ไม่มี import/export ในไฟล์นี้ตั้งใจ
// เพื่อให้ TypeScript ถือว่าเป็น "global script" แล้ว merge เข้ากับ lib.dom.d.ts ตรง ๆ)

interface PageResult<T> {
  items: T[];
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  from: number;
  to: number;
}

interface CallListOpts {
  roles?: string[];
  status?: string;
  sort: string;
  page: number;
  pageSize: number | string;
}

interface EventListOpts {
  type?: string;
  query?: string;
  sort: string;
  page: number;
  pageSize: number | string;
}

/** ฟิลด์ขั้นต่ำของ AgentCall (parse-log.ts) ที่ list.js/page.js ใช้จริง */
interface AgentCallLike {
  id: number;
  role: string;
  status: string;
  durationMs?: number;
  costUsd?: number;
  turns?: number;
}

/** ฟิลด์ขั้นต่ำของ LogEvent (parse-log.ts) ที่ list.js/page.js ใช้จริง */
interface LogEventLike {
  line: number;
  time: string;
  level: string;
  event: string;
  data: Record<string, unknown>;
}

/** API ที่ list.js ประกาศเป็น global `AgentTeamList` (โครงตรงกับ src/logview/list-assets.ts) */
interface AgentTeamListApi {
  PAGE_SIZES: number[];
  DEFAULT_PAGE_SIZE: number;
  roleStyle(role: string): { icon: string; cls: string };
  roleCounts(calls: AgentCallLike[]): { role: string; count: number }[];
  paginate<T>(items: T[], page: number | string, pageSize: number | string): PageResult<T>;
  // generic เพื่อคงชนิดของ element เดิม (เช่น AgentCall เต็มรูปแบบ ไม่ใช่แค่ AgentCallLike) ผ่าน filter/sort/paginate
  listCalls<T extends AgentCallLike>(calls: T[], opts: CallListOpts): PageResult<T>;
  pageOfCall<T extends AgentCallLike>(calls: T[], opts: CallListOpts, id: number): number;
  summaryOf(ev: LogEventLike): string;
  listEvents<T extends LogEventLike>(events: T[], opts: EventListOpts): PageResult<T>;
}

interface Window {
  /** ตั้งโดย render.ts ก่อนโหลด list.js/page.js: true เมื่อเปิดด้วย `agent-team logs --live` */
  __LIVE__?: boolean;
  /** ตั้งโดย list.js (โหลดก่อน page.js เสมอ ดู render.ts) */
  AgentTeamList?: AgentTeamListApi;
  /** ช่องให้เทสต์ควบคุมเวลา (Date.now) แบบ deterministic ถ้ามีการตั้งไว้ ดู now() ใน page.js */
  __NOW__?: number;
}
