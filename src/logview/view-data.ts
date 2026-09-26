import { diagnoseRun, type Finding } from './diagnose';
import { parseLog, type Run } from './parse-log';
import { loadCallTranscript, type CallTranscript } from './transcripts';

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
}): ViewData {
  const runs = parseLog(opts.logText).map((run): RunView => {
    const map = new Map<number, CallTranscript>();
    for (const call of run.calls) map.set(call.id, loadCallTranscript(opts.transcriptsDir, call));
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
