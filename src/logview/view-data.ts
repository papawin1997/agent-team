import { diagnoseRun, type Finding } from './diagnose';
import { parseLog, type Run } from './parse-log';
import { loadCallTranscript, type CallTranscript, type TranscriptCache } from './transcripts';

export interface RunView extends Run {
  findings: Finding[];
  /** key = AgentCall.id (เป็น string เพราะผ่าน JSON) */
  transcripts: Record<string, CallTranscript>;
}

export interface ViewData {
  projectDir: string;
  logFile: string;
  generatedAt: string;
  runs: RunView[];
}

export function buildViewData(opts: {
  projectDir: string;
  logFile: string;
  logText: string;
  transcriptsDir: string;
  now?: () => Date;
  /** cache ข้าม request เดียวกัน (server --live) กันอ่าน/พาร์ส transcript ซ้ำทุกครั้งที่ log ไม่เปลี่ยน */
  cache?: TranscriptCache;
}): ViewData {
  const runs = parseLog(opts.logText).map((run): RunView => {
    // ไฟล์ที่ call อื่นในรอบเดียวกันมี sessionId ชี้อยู่แล้ว: กันไม่ให้ call ที่หา session ด้วยเวลา (findByTime) แย่งไฟล์นั้นไป
    const exclude = new Set(
      run.calls.filter((c): c is typeof c & { sessionId: string } => !!c.sessionId).map((c) => `${c.sessionId}.jsonl`),
    );
    const map = new Map<number, CallTranscript>();
    for (const call of run.calls) {
      map.set(call.id, loadCallTranscript(opts.transcriptsDir, call, { exclude, cache: opts.cache }));
    }
    return {
      ...run,
      findings: diagnoseRun(run, map),
      transcripts: Object.fromEntries([...map].map(([id, t]) => [String(id), t])),
    };
  });
  return {
    projectDir: opts.projectDir,
    logFile: opts.logFile,
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
    runs,
  };
}

/**
 * รอบรันที่ควรเลือกไว้เป็นค่าเริ่มต้นในหน้า log: รอบล่าสุดที่เรียก agent หรือเจอปัญหา (findings)
 * ไม่ใช่รอบสุดท้ายเสมอไป เพราะรอบสุดท้ายอาจเป็นแค่ PM คุยต่อโดยยังไม่เรียก agent ใด ๆ ซึ่งจะบัง error ของรอบก่อนหน้า
 */
export function defaultRunIndex(runs: { calls: unknown[]; findings: unknown[] }[]): number {
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!;
    if (r.calls.length > 0 || r.findings.length > 0) return i;
  }
  return runs.length - 1;
}
