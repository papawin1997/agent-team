import type { JobInfo } from './jobs';
import type { Design, Requirements } from './schemas';
import type { Phase, State } from './state';

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
    d.securityNotes === undefined ? '  (Security ตรวจไม่สำเร็จ — ยังไม่มีผลตรวจ)' : list(d.securityNotes),
    '',
  ].join('\n');
}

const PHASE_LABELS: Record<Phase, string> = {
  REQUIREMENTS: 'คุย requirements กับ PM',
  DESIGN: 'ออกแบบ',
  REVIEW: 'รอยืนยัน design',
  BUILD: 'สร้างงาน/QA',
  DELIVER: 'รอตรวจรับ',
  DONE: 'เสร็จแล้ว',
  ABORTED: 'ยกเลิกแล้ว',
};

const pad2 = (n: number): string => String(n).padStart(2, '0');
const hhmm = (d: Date): string => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const localDateTime = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${hhmm(d)}`;

export function jobTitle(state: State): string {
  return state.requirements?.goal ?? state.title ?? '(ยังคุย requirements ไม่เสร็จ)';
}

function progressText(state: State): string | undefined {
  const tasks = state.design?.tasks;
  if (!tasks) return undefined;
  const done = tasks.filter((t) => state.progress[t.id]?.done).length;
  const current = tasks.find((t) => {
    const p = state.progress[t.id];
    return p !== undefined && !p.done && p.rounds > 0;
  });
  const p = current ? state.progress[current.id] : undefined;
  const working = current && p ? ` (กำลังทำ ${current.id}: QA รอบ ${p.rounds}/${p.maxRounds})` : '';
  return `เสร็จ ${done}/${tasks.length} task${working}`;
}

/** หนึ่งงานในเมนูเลือกงาน: บรรทัดสรุป + คำเตือน (ถ้ามี) บรรทัดถัดไป */
export function formatJobSummary(job: JobInfo, n: number, warning?: string): string {
  const { state } = job;
  const progress = progressText(state);
  const lock = job.lock
    ? ` (กำลังรันอยู่ pid ${job.lock.pid} ตั้งแต่ ${hhmm(new Date(job.lock.startedAt))})`
    : '';
  const line =
    `  ${n}) "${jobTitle(state)}" — เฟส ${state.phase} (${PHASE_LABELS[state.phase]})` +
    `${progress ? `, ${progress}` : ''} · รันล่าสุด ${localDateTime(job.updatedAt)}${lock}`;
  return warning ? `${line}\n     ${warning}` : line;
}

/** เตือนเมื่อมีงานอื่นแก้โค้ด (lastBuildAt) หลังจากงานนี้รันล่าสุด */
export function codeChangedWarning(job: JobInfo, all: readonly JobInfo[]): string | undefined {
  const newer = all
    .filter(
      (o) =>
        o.id !== job.id &&
        o.state.lastBuildAt !== undefined &&
        Date.parse(o.state.lastBuildAt) > job.updatedAt.getTime(),
    )
    .sort((a, b) => Date.parse(b.state.lastBuildAt!) - Date.parse(a.state.lastBuildAt!));
  const latest = newer[0];
  if (!latest) return undefined;
  const more = newer.length > 1 ? ` และอีก ${newer.length - 1} งาน` : '';
  return `⚠ งาน "${jobTitle(latest.state)}"${more} แก้โค้ดหลังจากงานนี้ โค้ดอาจเปลี่ยนไปแล้ว`;
}
