import type { Styler } from '../style';

/** agent ที่กำลังทำงาน (จาก StatusSink) */
export interface AgentRun {
  label: string;
  startedAt: number;
  /** คำอธิบาย tool ทุกครั้งที่เรียก ตามลำดับ */
  tools: readonly string[];
}

const RUNNING_TOOLS = 5;
const FINISHED_TOOLS = 8;

/** หัวบล็อกสรุป: ตัด "กำลัง…" ท้าย label ออก ("[QA] api: กำลังตรวจ" -> "[QA] api") */
export function blockTitle(label: string): string {
  return label.replace(/:?\s+กำลัง.*$/, '');
}

export function runningBlock(run: AgentRun, frame: string, elapsed: string): string[] {
  const hidden = run.tools.length - RUNNING_TOOLS;
  return [
    `${frame} ${run.label} (${elapsed})`,
    ...(hidden > 0 ? [`  … +${hidden} ก่อนหน้า`] : []),
    ...run.tools.slice(-RUNNING_TOOLS).map((t) => `  ⎿ ${t}`),
  ];
}

/** บล็อกสรุปที่พิมพ์ลง log ถาวร (undefined = สำเร็จโดยไม่ได้ใช้ tool ไม่ต้องพิมพ์) */
export function finishedBlock(run: AgentRun, ok: boolean, elapsed: string, s: Styler): string | undefined {
  if (ok && run.tools.length === 0) return undefined;
  const mark = ok ? s.green('⏺') : s.red('✗');
  const summary = `${ok ? 'เสร็จ' : 'ล้ม'}ใน ${elapsed} · ${run.tools.length} tools`;
  const hidden = run.tools.length - FINISHED_TOOLS;
  return [
    `${mark} ${s.bold(blockTitle(run.label))}  ${s.dim(summary)}`,
    ...(hidden > 0 ? [s.dim(`  ⎿ … +${hidden} (ดูทั้งหมด: agent-team logs)`)] : []),
    ...run.tools.slice(-FINISHED_TOOLS).map((t) => s.dim(`  ⎿ ${t}`)),
  ].join('\n');
}
