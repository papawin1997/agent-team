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

  it('success แต่ไม่มี structured_output: retry', async () => {
    const noOutput = { type: 'result', subtype: 'success', session_id: 's1' };
    const { runner, calls } = makeRunner([[initMsg(), noOutput], [initMsg(), okResult(validTurn)]]);
    await runner.pmTurn({ prompt: 'hi' });
    expect(calls).toHaveLength(2);
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
});
