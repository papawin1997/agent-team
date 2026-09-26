import { describe, expect, it } from 'vitest';
import { diagnoseRun } from '../../src/logview/diagnose';
import type { AgentCall, LogEvent, Run } from '../../src/logview/parse-log';
import type { CallTranscript, TranscriptStep } from '../../src/logview/transcripts';

const at = (ms: string) => `2026-01-10T09:${ms}.000Z`;
const call = (id: number, over: Partial<AgentCall> = {}): AgentCall => ({
  id,
  role: 'qa',
  resumed: false,
  start: at('01:00'),
  end: at('06:00'),
  status: 'ok',
  subtype: 'success',
  ...over,
});
const run = (calls: AgentCall[], over: Partial<Run> = {}): Run => ({
  index: 0,
  start: at('00:00'),
  status: 'error',
  events: [],
  calls,
  totalCostUsd: 0,
  ...over,
});
const apiError = (status: number | undefined, message: string, networkDown = false): TranscriptStep => ({
  kind: 'api_error',
  time: at('02:00'),
  status,
  message,
  networkDown,
});
const tx = (entries: [number, TranscriptStep[]][]): Map<number, CallTranscript> =>
  new Map(entries.map(([id, steps]) => [id, { steps }]));
const deny = (ms: string, role = 'qa'): LogEvent => ({
  line: 1,
  time: at(ms),
  level: 'WARN',
  event: 'guard.deny',
  data: { role, tool: 'Bash', target: 'rm -rf /', reason: 'คำสั่งอันตราย' },
});

describe('diagnoseRun', () => {
  it('529 Overloaded หลายครั้งในหลาย call -> finding เดียว นับรวม', () => {
    const calls = [call(0, { status: 'failed' }), call(1, { status: 'failed' })];
    const f = diagnoseRun(
      run(calls),
      tx([
        [0, [apiError(529, '529 Overloaded'), apiError(529, '529 Overloaded')]],
        [1, [apiError(529, '529 Overloaded')]],
      ]),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      severity: 'error',
      title: 'API ของ Anthropic รับโหลดไม่ไหว (529 Overloaded)',
      count: 3,
      callIds: [0, 1],
    });
  });

  it('เน็ตหลุด, 429, 401/403 และ error อื่นแยกเป็นคนละ finding', () => {
    const f = diagnoseRun(
      run([call(0, { status: 'failed' })]),
      tx([
        [
          0,
          [
            apiError(undefined, "Can't reach the API server", true),
            apiError(429, '429 rate limited'),
            apiError(401, 'unauthorized'),
            apiError(500, '500 Internal'),
          ],
        ],
      ]),
    );
    expect(f.map((x) => x.title)).toEqual([
      'เชื่อมต่อ API ไม่ได้ (อินเทอร์เน็ต/DNS)',
      'ชนลิมิตการใช้งาน (429 rate limit)',
      'login/สิทธิ์ใช้งานมีปัญหา (401/403)',
      'API error อื่น ๆ',
    ]);
    expect(f[3]).toMatchObject({ severity: 'warn', detail: '500 Internal' });
  });

  it('error_max_turns และ error_max_budget_usd', () => {
    const f = diagnoseRun(
      run([
        call(0, { role: 'backend', status: 'failed', subtype: 'error_max_turns' }),
        call(1, { role: 'qa', status: 'failed', subtype: 'error_max_budget_usd' }),
      ]),
      new Map(),
    );
    expect(f.map((x) => x.title)).toEqual(['agent backend ใช้ turn ครบ maxTurns', 'agent qa ใช้งบเกิน maxBudgetUsd']);
  });

  it('guard.deny -> รวมตาม role และไม่ขึ้น "ไม่ส่งผลลัพธ์" ซ้ำ', () => {
    const f = diagnoseRun(run([call(0, { status: 'failed' })], { events: [deny('02:00'), deny('03:00')] }), new Map());
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ severity: 'warn', title: 'guard ปฏิเสธคำสั่งของ qa', count: 2, callIds: [0] });
    expect(f[0]!.detail).toContain('Bash rm -rf /: คำสั่งอันตราย');
  });

  it('guard.deny เกิน 5 ครั้ง -> แสดง 5 บรรทัดแรกและบอกจำนวนที่เหลือ', () => {
    const events = [0, 1, 2, 3, 4, 5, 6].map((i) => deny(`02:0${i}`));
    const f = diagnoseRun(run([call(0, { status: 'failed' })], { events }), new Map());
    expect(f[0]!.detail.split('\n')).toHaveLength(6);
    expect(f[0]!.detail).toContain('และอีก 2 ครั้ง');
  });

  it('จบแบบ success แต่ไม่ส่ง structured output และไม่มีสาเหตุอื่น', () => {
    const f = diagnoseRun(run([call(0, { status: 'failed' })]), new Map());
    expect(f).toEqual([
      {
        severity: 'warn',
        title: 'agent qa จบโดยไม่ส่งผลลัพธ์ (structured output)',
        detail: expect.stringContaining('StructuredOutput'),
        callIds: [0],
        count: 1,
      },
    ]);
  });

  it('มี 529 แล้ว ไม่ต้องขึ้น "ไม่ส่งผลลัพธ์" ซ้ำ', () => {
    const f = diagnoseRun(run([call(0, { status: 'failed' })]), tx([[0, [apiError(529, '529 Overloaded')]]]));
    expect(f.map((x) => x.title)).toEqual(['API ของ Anthropic รับโหลดไม่ไหว (529 Overloaded)']);
  });

  it('agent.no_result หรือ call ค้างในรอบที่ error -> หยุดกลางคัน', () => {
    expect(diagnoseRun(run([call(0, { status: 'failed', subtype: 'no_result' })]), new Map())[0]!.title).toBe(
      'agent qa หยุดกลางคันโดยไม่มีผลลัพธ์',
    );
    const stuck = call(0, { status: 'unfinished', subtype: undefined, end: undefined });
    expect(diagnoseRun(run([stuck]), new Map())[0]!.title).toBe('agent qa หยุดกลางคันโดยไม่มีผลลัพธ์');
  });

  it('call ค้างในรอบที่ยังรันอยู่หรือถูก Ctrl+C -> ไม่ถือเป็นปัญหา', () => {
    const stuck = call(0, { status: 'unfinished', subtype: undefined, end: undefined });
    expect(diagnoseRun(run([stuck], { status: 'unfinished' }), new Map())).toEqual([]);
    expect(diagnoseRun(run([stuck], { status: 'interrupted' }), new Map())).toEqual([]);
  });

  it('รอบ error ที่ไม่เข้ากฎไหน -> info พร้อมข้อความ error', () => {
    expect(diagnoseRun(run([], { errorMessage: 'boom' }), new Map())).toEqual([
      { severity: 'info', title: 'ไม่พบสาเหตุที่รู้จัก', detail: 'boom', callIds: [], count: 1 },
    ]);
  });

  it('รอบที่ปกติ -> ไม่มี finding', () => {
    expect(diagnoseRun(run([call(0)], { status: 'done' }), new Map())).toEqual([]);
  });

  it('เรียง error ก่อน warn', () => {
    const f = diagnoseRun(
      run([call(0, { status: 'failed' }), call(1, { role: 'backend', status: 'failed', subtype: 'error_max_turns' })]),
      new Map(),
    );
    expect(f.map((x) => x.severity)).toEqual(['error', 'warn']);
  });

  it('error_max_structured_output_retries -> warn เฉพาะเจาะจง', () => {
    const f = diagnoseRun(
      run([call(0, { status: 'failed', subtype: 'error_max_structured_output_retries' })]),
      new Map(),
    );
    expect(f).toEqual([
      {
        severity: 'warn',
        title: 'agent qa ส่งผลลัพธ์ผิดรูปแบบซ้ำจนเกินจำนวนครั้ง',
        detail:
          'agent พยายามส่ง structured output แต่ JSON ไม่ผ่าน schema หลายครั้ง — เปิด transcript ของครั้งนี้ดูผลลัพธ์สุดท้าย แล้วลองรันใหม่ด้วย -r',
        callIds: [0],
        count: 1,
      },
    ]);
  });

  it('subtype error_* อื่น ๆ ที่ไม่รู้จัก -> warn ทั่วไปแทนที่จะหายไป', () => {
    const f = diagnoseRun(run([call(0, { status: 'failed', subtype: 'error_during_execution' })]), new Map());
    expect(f.map((x) => x.title)).toEqual(['agent qa ล้มเหลว (error_during_execution)']);
  });

  it('guard.deny ของ role อื่น ไม่บัง finding ของ failed call ที่ subtype ไม่รู้จัก', () => {
    const f = diagnoseRun(
      run(
        [call(0, { role: 'qa', status: 'failed', subtype: 'error_during_execution' })],
        { events: [deny('02:00', 'backend')] },
      ),
      new Map(),
    );
    expect(f.map((x) => x.title).sort()).toEqual(
      ['agent qa ล้มเหลว (error_during_execution)', 'guard ปฏิเสธคำสั่งของ backend'].sort(),
    );
  });

  it('error_max_turns ไม่ขึ้น fallback ซ้ำ (มี finding เดียว)', () => {
    const f = diagnoseRun(run([call(0, { status: 'failed', subtype: 'error_max_turns' })]), new Map());
    expect(f).toHaveLength(1);
    expect(f[0]!.title).toBe('agent qa ใช้ turn ครบ maxTurns');
  });
});
