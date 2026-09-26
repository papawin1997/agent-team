export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogEvent {
  /** เลขบรรทัดในไฟล์ (เริ่มที่ 1) */
  line: number;
  /** ISO time ('' เมื่อบรรทัดอ่านรูปแบบไม่ออก) */
  time: string;
  /** RAW = บรรทัดที่อ่านรูปแบบไม่ออก */
  level: LogLevel | 'RAW';
  event: string;
  data: Record<string, unknown>;
}

export type CallStatus = 'ok' | 'failed' | 'unfinished';

/** หนึ่งครั้งที่เรียก agent: จับคู่ agent.start กับ agent.result / agent.no_result ของ role เดียวกัน */
export interface AgentCall {
  /** ลำดับภายในรอบรัน (เริ่มที่ 0) */
  id: number;
  role: string;
  model?: string;
  resumed: boolean;
  start: string;
  end?: string;
  status: CallStatus;
  subtype?: string;
  durationMs?: number;
  turns?: number;
  costUsd?: number;
  sessionId?: string;
}

export type RunStatus = 'done' | 'aborted' | 'error' | 'interrupted' | 'unfinished';

/** หนึ่งรอบรัน: ตั้งแต่ run.start ถึงก่อน run.start ถัดไป */
export interface Run {
  index: number;
  start: string;
  /** เวลาของ event สุดท้ายในรอบ */
  end?: string;
  jobId?: string;
  status: RunStatus;
  errorMessage?: string;
  events: LogEvent[];
  calls: AgentCall[];
  totalCostUsd: number;
}

const LINE = /^(\S+) (INFO|WARN|ERROR)\s+(\S+)(?: (.*))?$/;

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function parseLogLine(text: string, line: number): LogEvent {
  const m = LINE.exec(text);
  if (!m) return { line, time: '', level: 'RAW', event: 'raw', data: { text } };
  const [, time, level, event, json] = m;
  let data: Record<string, unknown> = {};
  if (json !== undefined) {
    try {
      const parsed: unknown = JSON.parse(json);
      data =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { value: parsed };
    } catch {
      data = { raw: json };
    }
  }
  return { line, time: time!, level: level as LogLevel, event: event!, data };
}

export function parseLog(text: string): Run[] {
  const runs: Run[] = [];
  let current: Run | undefined;
  /** call ที่ยังรอ result แยกตาม role */
  const open = new Map<string, AgentCall>();
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    const ev = parseLogLine(raw, i + 1);
    if (!current || ev.event === 'run.start') {
      current = { index: runs.length, start: ev.time, status: 'unfinished', events: [], calls: [], totalCostUsd: 0 };
      runs.push(current);
      open.clear();
    }
    current.events.push(ev);
    apply(current, ev, open);
  });
  return runs;
}

function apply(run: Run, ev: LogEvent, open: Map<string, AgentCall>): void {
  const d = ev.data;
  if (ev.time) run.end = ev.time;
  switch (ev.event) {
    case 'job.selected':
      run.jobId = str(d.jobId) ?? run.jobId;
      break;
    case 'agent.start': {
      const role = str(d.role) ?? '?';
      const call: AgentCall = {
        id: run.calls.length,
        role,
        model: str(d.model),
        resumed: d.resumed === true,
        start: ev.time,
        status: 'unfinished',
      };
      run.calls.push(call);
      open.set(role, call);
      break;
    }
    case 'agent.result':
    case 'agent.no_result': {
      const role = str(d.role) ?? '?';
      const call = open.get(role);
      if (!call) break;
      open.delete(role);
      call.end = ev.time;
      call.sessionId = str(d.sessionId) || undefined;
      if (ev.event === 'agent.no_result') {
        call.status = 'failed';
        call.subtype = 'no_result';
        break;
      }
      // runner บันทึก agent.result เป็น WARN เมื่อไม่ได้ structured output
      call.status = ev.level === 'INFO' ? 'ok' : 'failed';
      call.subtype = str(d.subtype);
      call.durationMs = num(d.durationMs);
      call.turns = num(d.turns);
      call.costUsd = num(d.costUsd);
      if (call.costUsd !== undefined) run.totalCostUsd += call.costUsd;
      break;
    }
    case 'run.end':
      run.status = str(d.phase) === 'DONE' ? 'done' : 'aborted';
      break;
    case 'run.error':
      run.status = 'error';
      run.errorMessage = str(d.message);
      run.jobId = run.jobId ?? str(d.jobId);
      break;
    case 'run.interrupted':
      run.status = 'interrupted';
      break;
  }
}
