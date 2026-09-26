import { describe, expect, it } from 'vitest';
import { parseLog, parseLogLine } from '../../src/logview/parse-log';

const LOG = [
  '2026-01-10T09:00:00.000Z INFO  run.start {"projectDir":"/work/app","resume":false,"pid":1}',
  '2026-01-10T09:00:00.100Z INFO  job.selected {"jobId":"20260110-160000","resume":false}',
  '2026-01-10T09:00:01.000Z INFO  agent.start {"role":"pm","model":"claude-sonnet-5","resumed":false,"promptChars":72}',
  '2026-01-10T09:00:20.000Z INFO  agent.result {"role":"pm","subtype":"success","durationMs":19000,"turns":3,"costUsd":0.25,"sessionId":"s-pm"}',
  '2026-01-10T09:01:00.000Z INFO  agent.start {"role":"qa","model":"claude-sonnet-5","resumed":false,"promptChars":500}',
  '2026-01-10T09:06:00.000Z WARN  agent.result {"role":"qa","subtype":"success","durationMs":300000,"turns":1,"costUsd":0.5,"sessionId":"s-qa"}',
  '2026-01-10T09:06:01.000Z ERROR run.error {"jobId":"20260110-160000","message":"qa: จบงานโดยไม่ได้ส่ง structured output"}',
  '2026-01-10T15:00:00.000Z INFO  run.start {"projectDir":"/work/app","resume":true,"pid":2}',
  'this line is broken',
  '2026-01-10T15:00:05.000Z INFO  agent.start {"role":"backend","model":"claude-sonnet-5","resumed":false,"promptChars":10}',
].join('\n');

const T = '2026-01-10T09:00:00.000Z';

describe('parseLogLine', () => {
  it('แยกเวลา, level, event และ JSON', () => {
    expect(parseLogLine(`${T} WARN  guard.deny {"role":"qa","tool":"Bash"}`, 7)).toEqual({
      line: 7,
      time: T,
      level: 'WARN',
      event: 'guard.deny',
      data: { role: 'qa', tool: 'Bash' },
    });
  });

  it('บรรทัดที่ไม่มี JSON -> data ว่าง', () => {
    expect(parseLogLine(`${T} INFO  team.end`, 1).data).toEqual({});
  });

  it('JSON พัง -> เก็บข้อความดิบไว้ใน data.raw', () => {
    expect(parseLogLine(`${T} INFO  say {"text":`, 1).data).toEqual({ raw: '{"text":' });
  });

  it('รูปแบบไม่ตรง -> level RAW', () => {
    expect(parseLogLine('this line is broken', 3)).toEqual({
      line: 3,
      time: '',
      level: 'RAW',
      event: 'raw',
      data: { text: 'this line is broken' },
    });
  });
});

describe('parseLog', () => {
  const runs = parseLog(LOG);

  it('แบ่งรอบรันตาม run.start', () => {
    expect(runs).toHaveLength(2);
    expect(runs[0]!.events).toHaveLength(7);
    expect(runs[1]!.events).toHaveLength(3);
  });

  it('รอบที่ error: jobId, สถานะ, ข้อความ, เวลาเริ่ม/จบ, cost รวม', () => {
    expect(runs[0]).toMatchObject({
      index: 0,
      start: '2026-01-10T09:00:00.000Z',
      end: '2026-01-10T09:06:01.000Z',
      jobId: '20260110-160000',
      status: 'error',
      errorMessage: 'qa: จบงานโดยไม่ได้ส่ง structured output',
      totalCostUsd: 0.75,
    });
  });

  it('จับคู่ agent.start กับ agent.result ของ role เดียวกัน (WARN = ไม่สำเร็จ)', () => {
    expect(runs[0]!.calls).toEqual([
      {
        id: 0, role: 'pm', model: 'claude-sonnet-5', resumed: false,
        start: '2026-01-10T09:00:01.000Z', end: '2026-01-10T09:00:20.000Z',
        status: 'ok', subtype: 'success', durationMs: 19000, turns: 3, costUsd: 0.25, sessionId: 's-pm',
      },
      {
        id: 1, role: 'qa', model: 'claude-sonnet-5', resumed: false,
        start: '2026-01-10T09:01:00.000Z', end: '2026-01-10T09:06:00.000Z',
        status: 'failed', subtype: 'success', durationMs: 300000, turns: 1, costUsd: 0.5, sessionId: 's-qa',
      },
    ]);
  });

  it('รอบที่ยังไม่จบ: call ค้างเป็น unfinished และเก็บบรรทัดพังไว้', () => {
    const r = runs[1]!;
    expect(r.status).toBe('unfinished');
    expect(r.calls[0]).toMatchObject({ role: 'backend', status: 'unfinished' });
    expect(r.calls[0]!.end).toBeUndefined();
    expect(r.events.map((e) => e.level)).toEqual(['INFO', 'RAW', 'INFO']);
  });

  it('run.end DONE/ABORTED และ run.interrupted', () => {
    expect(parseLog(`${T} INFO  run.start {}\n${T} INFO  run.end {"phase":"DONE"}`)[0]!.status).toBe('done');
    expect(parseLog(`${T} INFO  run.start {}\n${T} INFO  run.end {"phase":"ABORTED"}`)[0]!.status).toBe('aborted');
    expect(parseLog(`${T} INFO  run.start {}\n${T} WARN  run.interrupted {"signal":"SIGINT"}`)[0]!.status).toBe(
      'interrupted',
    );
  });

  it('agent.no_result -> failed ด้วย subtype no_result', () => {
    const [r] = parseLog(
      `${T} INFO  run.start {}\n${T} INFO  agent.start {"role":"qa"}\n${T} WARN  agent.no_result {"role":"qa","sessionId":"s1"}`,
    );
    expect(r!.calls[0]).toMatchObject({ status: 'failed', subtype: 'no_result', sessionId: 's1' });
  });

  it('บรรทัดก่อน run.start แรก และ CRLF ยังอ่านได้', () => {
    const r = parseLog(`${T} INFO  say {"text":"x"}\r\n${T} INFO  run.start {}\r\n`);
    expect(r).toHaveLength(2);
    expect(r[0]!.events[0]!.event).toBe('say');
  });

  it('ไฟล์ว่าง -> ไม่มีรอบ', () => {
    expect(parseLog('')).toEqual([]);
  });
});
