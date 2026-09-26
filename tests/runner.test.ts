import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { RoleOutputError, RoleRunError, SdkRoleRunner } from '../src/runner';
import { makeDesign, makeRequirements, makeTask } from './helpers/builders';

type Msg = Record<string, unknown>;
type Call = { prompt: string; options: Record<string, any> };

const initMsg = (sid = 's1'): Msg => ({
  type: 'system',
  subtype: 'init',
  session_id: sid,
  skills: [],
  plugins: [],
  tools: [],
});
const okResult = (output: unknown, sid = 's1'): Msg => ({
  type: 'result',
  subtype: 'success',
  session_id: sid,
  structured_output: output,
  total_cost_usd: 0.01,
});
const errResult = (subtype: string): Msg => ({ type: 'result', subtype, session_id: 's1' });

const validTurn = { message: 'สวัสดี', status: 'asking' };

function makeRunner(scripts: Array<Msg[] | Error>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const queryFn = ((args: Call) => {
    calls.push(args);
    const script = scripts.shift();
    if (!script) throw new Error('queryFn: script หมด');
    return (async function* () {
      if (script instanceof Error) throw script;
      for (const message of script) yield message;
    })();
  }) as never;
  const runner = new SdkRoleRunner({
    projectDir: 'proj',
    config: DEFAULT_CONFIG,
    queryFn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { runner, calls, sleeps };
}

describe('SdkRoleRunner', () => {
  it('คืน structured output ที่ผ่าน schema พร้อม sessionId', async () => {
    const { runner, calls } = makeRunner([[initMsg(), okResult(validTurn)]]);
    const out = await runner.pmTurn({ prompt: 'hi' });

    expect(out).toEqual({ turn: validTurn, sessionId: 's1' });
    expect(calls[0]!.prompt).toBe('hi');
    expect(calls[0]!.options.outputFormat.type).toBe('json_schema');
    expect(calls[0]!.options.model).toBe('claude-sonnet-5');
  });

  it('บันทึก log เริ่ม/จบของทุกการเรียก agent พร้อม turns, เวลา และ cost', async () => {
    const events: Array<{ level: string; event: string; data: Record<string, unknown> }> = [];
    const scripts: Msg[][] = [
      [initMsg(), { ...okResult(validTurn), duration_ms: 1234, num_turns: 3 }],
      [initMsg(), errResult('error_max_turns')],
    ];
    const runner = new SdkRoleRunner({
      projectDir: 'proj',
      config: DEFAULT_CONFIG,
      queryFn: (() => {
        const script = scripts.shift()!;
        return (async function* () {
          for (const message of script) yield message;
        })();
      }) as never,
      sleep: async () => {},
      logger: { log: (level, event, data) => void events.push({ level, event, data: data as never }) },
    });

    await runner.pmTurn({ prompt: 'hi' });
    await expect(runner.pmTurn({ prompt: 'again' })).rejects.toThrow('error_max_turns');

    expect(events.map((e) => `${e.level} ${e.event}`)).toEqual([
      'INFO agent.start',
      'INFO agent.result',
      'INFO agent.start',
      'WARN agent.result',
    ]);
    expect(events[0]!.data).toMatchObject({ role: 'pm', model: 'claude-sonnet-5', resumed: false });
    expect(events[1]!.data).toMatchObject({
      role: 'pm',
      subtype: 'success',
      durationMs: 1234,
      turns: 3,
      costUsd: 0.01,
      sessionId: 's1',
    });
    expect(events[3]!.data).toMatchObject({ role: 'pm', subtype: 'error_max_turns' });
  });

  it('ส่ง sessionId เดิมเป็น resume ให้ PM', async () => {
    const { runner, calls } = makeRunner([[initMsg('s9'), okResult(validTurn, 's9')]]);
    await runner.pmTurn({ prompt: 'hi', sessionId: 's9' });
    expect(calls[0]!.options.resume).toBe('s9');
  });

  it('retry เมื่อ SDK โยน error แล้วสำเร็จ', async () => {
    const { runner, calls, sleeps } = makeRunner([new Error('network'), [initMsg(), okResult(validTurn)]]);
    const out = await runner.pmTurn({ prompt: 'hi' });

    expect(out.turn).toEqual(validTurn);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it('ล้มต่อเนื่อง: retry 2 ครั้งแล้วยอมแพ้', async () => {
    const { runner, calls, sleeps } = makeRunner([new Error('network'), new Error('network'), new Error('network')]);
    await expect(runner.pmTurn({ prompt: 'hi' })).rejects.toThrow('network');

    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 3000]);
  });

  it('error_max_turns ไม่ retry', async () => {
    const { runner, calls, sleeps } = makeRunner([[initMsg(), errResult('error_max_turns')]]);
    await expect(runner.pmTurn({ prompt: 'hi' })).rejects.toBeInstanceOf(RoleRunError);

    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('error_max_turns: RoleRunError พก subtype และ retryable=false', async () => {
    const { runner } = makeRunner([[initMsg(), errResult('error_max_turns')]]);
    const err = await runner.pmTurn({ prompt: 'hi' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RoleRunError);
    expect((err as RoleRunError).subtype).toBe('error_max_turns');
    expect((err as RoleRunError).retryable).toBe(false);
  });

  it('success แต่ไม่มี structured_output: retry', async () => {
    const noOutput = { type: 'result', subtype: 'success', session_id: 's1' };
    const { runner, calls } = makeRunner([[initMsg(), noOutput], [initMsg(), okResult(validTurn)]]);
    await runner.pmTurn({ prompt: 'hi' });
    expect(calls).toHaveLength(2);
  });

  it('success แต่ไม่มี structured_output ทุกรอบ: error บอกชัดว่าไม่ได้ส่ง structured output (ไม่ใช่ "pm: success")', async () => {
    const noOutput = { type: 'result', subtype: 'success', session_id: 's1' };
    const { runner } = makeRunner([[initMsg(), noOutput], [initMsg(), noOutput], [initMsg(), noOutput]]);
    await expect(runner.pmTurn({ prompt: 'hi' })).rejects.toThrow(
      'pm: จบงานโดยไม่ได้ส่ง structured output (ดู guard.deny ใน log)',
    );
  });

  it('output ผิด schema: ถาม agent เดิมซ้ำ 1 ครั้งด้วย resume', async () => {
    const { runner, calls } = makeRunner([
      [initMsg('s1'), okResult({ message: '', status: 'asking' })],
      [initMsg('s2'), okResult(validTurn, 's2')],
    ]);
    const out = await runner.pmTurn({ prompt: 'hi' });

    expect(out.sessionId).toBe('s2');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.options.resume).toBe('s1');
    expect(calls[1]!.prompt).toContain('schema');
  });

  it('output ผิด schema ซ้ำ: โยน RoleOutputError', async () => {
    const bad = { message: '', status: 'asking' };
    const { runner } = makeRunner([
      [initMsg(), okResult(bad)],
      [initMsg(), okResult(bad)],
    ]);
    await expect(runner.pmTurn({ prompt: 'hi' })).rejects.toBeInstanceOf(RoleOutputError);
  });

  it('planning ใช้ model ของ planning และ prompt มี requirements', async () => {
    const { runner, calls } = makeRunner([[initMsg(), okResult(makeDesign())]]);
    const design = await runner.plan({ requirements: makeRequirements() });

    expect(design.tasks).toHaveLength(2);
    expect(calls[0]!.options.model).toBe('claude-opus-5');
    expect(calls[0]!.prompt).toContain('todo list');
  });

  it('worker เลือก role ตาม task.owner', async () => {
    const result = { taskId: 'ui', summary: 'เสร็จ', filesChanged: [], howToVerify: '' };
    const { runner, calls } = makeRunner([[initMsg(), okResult(result)]]);
    await runner.work({
      task: makeTask('ui', 'frontend'),
      design: makeDesign(),
      requirements: makeRequirements(),
    });

    expect(calls[0]!.options.tools).toContain('Edit');
    expect(calls[0]!.options.systemPrompt).toContain('frontend worker');
  });

  it('securityDesign คืน securityNotes จาก structured output', async () => {
    const { runner, calls } = makeRunner([[initMsg(), okResult({ securityNotes: ['เก็บ password แบบ hash'] })]]);
    const notes = await runner.securityDesign({ design: makeDesign(), requirements: makeRequirements() });

    expect(notes).toEqual(['เก็บ password แบบ hash']);
    expect(calls[0]!.options.model).toBe('claude-sonnet-5');
  });

  it('security คืน SecurityReport จาก structured output', async () => {
    const report = { taskId: 'api', verdict: 'PASS', issues: [] };
    const { runner } = makeRunner([[initMsg(), okResult(report)]]);
    const out = await runner.security({
      task: makeTask('api'),
      design: makeDesign(),
      requirements: makeRequirements(),
      result: { taskId: 'api', summary: 'เสร็จ', filesChanged: ['src/api.ts'], howToVerify: 'npm test' },
    });

    expect(out).toEqual(report);
  });
});

describe('SdkRoleRunner: สถานะระหว่าง agent ทำงาน', () => {
  function runnerWithStatus(scripts: Array<Msg[] | Error>) {
    const events: string[] = [];
    const queryFn = (() => {
      const script = scripts.shift();
      if (!script) throw new Error('queryFn: script หมด');
      return (async function* () {
        if (script instanceof Error) throw script;
        for (const message of script) yield message;
      })();
    }) as never;
    const runner = new SdkRoleRunner({
      projectDir: 'proj',
      config: DEFAULT_CONFIG,
      queryFn,
      sleep: async () => {},
      status: {
        start: (label) => void events.push(`start ${label}`),
        update: (detail) => void events.push(`update ${detail}`),
        stop: () => void events.push('stop'),
      },
    });
    return { runner, events };
  }

  const toolUse = (name: string, input: unknown): Msg => ({
    type: 'assistant',
    session_id: 's1',
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text: 'ขอดูไฟล์ก่อน' }, { type: 'tool_use', id: 't1', name, input }] },
  });

  it('start → update ทุก tool_use → stop', async () => {
    const { runner, events } = runnerWithStatus([
      [initMsg(), toolUse('Read', { file_path: 'src/a.ts' }), toolUse('Bash', { command: 'npm test' }), okResult(validTurn)],
    ]);

    await runner.pmTurn({ prompt: 'hi' });

    expect(events).toEqual([
      'start [PM] กำลังคิด',
      'update อ่านไฟล์ src/a.ts',
      'update รันคำสั่ง npm test',
      'stop',
    ]);
  });

  it('label ของ worker และ security มี task id', async () => {
    const result = { taskId: 'ui', summary: 'เสร็จ', filesChanged: [], howToVerify: '' };
    const report = { taskId: 'api', verdict: 'PASS', issues: [] };
    const { runner, events } = runnerWithStatus([
      [initMsg(), okResult(result)],
      [initMsg(), okResult(report)],
    ]);

    await runner.work({ task: makeTask('ui', 'frontend'), design: makeDesign(), requirements: makeRequirements() });
    await runner.security({
      task: makeTask('api'),
      design: makeDesign(),
      requirements: makeRequirements(),
      result: { taskId: 'api', summary: 'เสร็จ', filesChanged: ['src/api.ts'], howToVerify: 'npm test' },
    });

    expect(events).toEqual([
      'start [frontend] ui: กำลังทำงาน',
      'stop',
      'start [Security] api: กำลังตรวจความปลอดภัย',
      'stop',
    ]);
  });

  it('stop เสมอแม้ agent ล้ม และ retry เริ่มนับใหม่', async () => {
    const { runner, events } = runnerWithStatus([new Error('network'), [initMsg(), errResult('error_max_turns')]]);

    await expect(runner.pmTurn({ prompt: 'hi' })).rejects.toThrow('error_max_turns');

    expect(events).toEqual(['start [PM] กำลังคิด', 'stop', 'start [PM] กำลังคิด', 'stop']);
  });
});
