import type { AgentCall, LogEvent, Run } from './parse-log';
import type { CallTranscript, TranscriptStep } from './transcripts';

export type Severity = 'error' | 'warn' | 'info';

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  /** id ของ AgentCall ที่เกี่ยวข้อง */
  callIds: number[];
  /** จำนวนครั้งที่เจอ (เช่น API error กี่ครั้ง) */
  count: number;
}

type Base = Pick<Finding, 'severity' | 'title' | 'detail'>;
type ApiError = Extract<TranscriptStep, { kind: 'api_error' }>;

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
const RESUME_HINT = 'แล้วทำงานต่อด้วย agent-team <path> -r';

const NETWORK: Base = {
  severity: 'error',
  title: 'เชื่อมต่อ API ไม่ได้ (อินเทอร์เน็ต/DNS)',
  detail: `เครื่องต่ออินเทอร์เน็ตไม่ได้หรือหา api.anthropic.com ไม่เจอ — ตรวจเน็ต/VPN/proxy ${RESUME_HINT}`,
};
const OVERLOADED: Base = {
  severity: 'error',
  title: 'API ของ Anthropic รับโหลดไม่ไหว (529 Overloaded)',
  detail: `ปัญหาชั่วคราวฝั่งเซิร์ฟเวอร์ ไม่ใช่ bug ของโปรเจกต์หรือ agent — รอสักพัก ${RESUME_HINT} (สถานะ: https://status.claude.com)`,
};
const RATE_LIMIT: Base = {
  severity: 'error',
  title: 'ชนลิมิตการใช้งาน (429 rate limit)',
  detail: `โควตา subscription ช่วงนี้หมด — รอให้รีเซ็ต ${RESUME_HINT}`,
};
const AUTH: Base = {
  severity: 'error',
  title: 'login/สิทธิ์ใช้งานมีปัญหา (401/403)',
  detail: 'ตรวจ login ด้วย npm run smoke:auth แล้ว login Claude ใหม่',
};

const apiErrors = (t: CallTranscript | undefined): ApiError[] =>
  (t?.steps ?? []).filter((s): s is ApiError => s.kind === 'api_error');

const inWindow = (ev: LogEvent, call: AgentCall): boolean =>
  ev.time >= call.start && (call.end === undefined || ev.time <= call.end);

export function diagnoseRun(run: Run, transcripts: ReadonlyMap<number, CallTranscript>): Finding[] {
  const found = new Map<string, Finding>();
  const add = (key: string, base: Base, callId: number, count = 1): void => {
    const f = found.get(key) ?? { ...base, callIds: [], count: 0 };
    f.count += count;
    if (!f.callIds.includes(callId)) f.callIds.push(callId);
    found.set(key, f);
  };
  const denials = run.events.filter((e) => e.event === 'guard.deny');

  for (const call of run.calls) {
    const errs = apiErrors(transcripts.get(call.id));
    const taken = new Set<ApiError>();
    const pick = (test: (e: ApiError) => boolean): ApiError[] => {
      const hits = errs.filter((e) => !taken.has(e) && test(e));
      hits.forEach((e) => taken.add(e));
      return hits;
    };
    const network = pick((e) => e.networkDown);
    const overloaded = pick((e) => e.status === 529 || /overloaded/i.test(e.message));
    const rate = pick((e) => e.status === 429);
    const auth = pick((e) => e.status === 401 || e.status === 403);
    const other = pick(() => true);
    if (overloaded.length) add('overloaded', OVERLOADED, call.id, overloaded.length);
    if (network.length) add('network', NETWORK, call.id, network.length);
    if (rate.length) add('rate_limit', RATE_LIMIT, call.id, rate.length);
    if (auth.length) add('auth', AUTH, call.id, auth.length);
    if (other.length) {
      add('api_other', { severity: 'warn', title: 'API error อื่น ๆ', detail: other[0]!.message }, call.id, other.length);
    }

    if (call.subtype === 'error_max_turns') {
      add(
        `max_turns:${call.role}`,
        {
          severity: 'error',
          title: `agent ${call.role} ใช้ turn ครบ maxTurns`,
          detail: 'task ใหญ่เกินจำนวน turn ที่ให้ — เพิ่ม maxTurns ของ role นี้ใน agent-team.config.json หรือแตก task ให้เล็กลง',
        },
        call.id,
      );
    }
    if (call.subtype === 'error_max_budget_usd') {
      add(
        `max_budget:${call.role}`,
        {
          severity: 'error',
          title: `agent ${call.role} ใช้งบเกิน maxBudgetUsd`,
          detail: 'เพิ่ม maxBudgetUsd ของ role นี้ใน agent-team.config.json หรือแตก task ให้เล็กลง',
        },
        call.id,
      );
    }
    const denied = denials.some((e) => e.data.role === call.role && inWindow(e, call));
    if (call.status === 'failed' && call.subtype === 'success' && errs.length === 0 && !denied) {
      add(
        `no_output:${call.role}`,
        {
          severity: 'warn',
          title: `agent ${call.role} จบโดยไม่ส่งผลลัพธ์ (structured output)`,
          detail: 'agent หยุดตอบโดยไม่เรียก StructuredOutput — เปิด transcript ของครั้งนี้ดูข้อความสุดท้ายของ agent',
        },
        call.id,
      );
    }
    const stopped =
      call.subtype === 'no_result' ||
      (call.status === 'unfinished' && run.status !== 'unfinished' && run.status !== 'interrupted');
    if (stopped && errs.length === 0) {
      add(
        `no_result:${call.role}`,
        {
          severity: 'error',
          title: `agent ${call.role} หยุดกลางคันโดยไม่มีผลลัพธ์`,
          detail: 'stream ของ SDK จบก่อนได้ result หรือเกิด exception — ดูข้อความ error ของรอบรันและ transcript ของครั้งนี้',
        },
        call.id,
      );
    }
  }

  const byRole = new Map<string, LogEvent[]>();
  for (const e of denials) {
    const role = typeof e.data.role === 'string' ? e.data.role : '?';
    byRole.set(role, [...(byRole.get(role) ?? []), e]);
  }
  for (const [role, list] of byRole) {
    const lines = list
      .slice(0, 5)
      .map((e) => `${String(e.data.tool ?? '?')}${e.data.target ? ` ${String(e.data.target)}` : ''}: ${String(e.data.reason ?? '')}`);
    const more = list.length > 5 ? `\n…และอีก ${list.length - 5} ครั้ง` : '';
    const callIds = run.calls.filter((c) => c.role === role && list.some((e) => inWindow(e, c))).map((c) => c.id);
    found.set(`guard:${role}`, {
      severity: 'warn',
      title: `guard ปฏิเสธคำสั่งของ ${role}`,
      detail: `${lines.join('\n')}${more}`,
      callIds,
      count: list.length,
    });
  }

  if (found.size === 0 && run.status === 'error') {
    found.set('unknown', {
      severity: 'info',
      title: 'ไม่พบสาเหตุที่รู้จัก',
      detail: run.errorMessage ?? 'ดูข้อความ error ของรอบรันใน timeline',
      callIds: [],
      count: 1,
    });
  }

  return [...found.values()].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.callIds[0] ?? Number.POSITIVE_INFINITY) - (b.callIds[0] ?? Number.POSITIVE_INFINITY),
  );
}
