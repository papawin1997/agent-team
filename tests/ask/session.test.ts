import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HandoffStore } from '../../src/ask/handoff-store';
import { askJobPrompt, runAsk } from '../../src/ask/session';
import type { AdviseInput, AdvisorRunner } from '../../src/deps';
import type { Handoff } from '../../src/schemas';
import { ScriptedIO } from '../helpers/fakes';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const newStore = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-asksession-'));
  dirs.push(d);
  return new HandoffStore(d);
};

class FakeAdvisor implements AdvisorRunner {
  calls: Array<{ kind: 'advise' | 'handoff'; prompt?: string; sessionId?: string }> = [];
  private n = 0;
  constructor(
    private readonly answers: Array<string | Error>,
    private readonly handoffs: Array<Handoff | Error> = [],
  ) {}

  async advise(input: AdviseInput): Promise<{ text: string; sessionId: string }> {
    this.calls.push({ kind: 'advise', prompt: input.prompt, sessionId: input.sessionId });
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error('FakeAdvisor: answers หมด');
    if (answer instanceof Error) throw answer;
    this.n += 1;
    return { text: answer, sessionId: `s${this.n}` };
  }

  async handoff(sessionId: string): Promise<{ handoff: Handoff; sessionId: string }> {
    this.calls.push({ kind: 'handoff', sessionId });
    const h = this.handoffs.shift();
    if (h === undefined) throw new Error('FakeAdvisor: handoffs หมด');
    if (h instanceof Error) throw h;
    this.n += 1;
    return { handoff: h, sessionId: `s${this.n}` };
  }
}

const H: Handoff = { title: 'เรื่อง export', markdown: '## เป้าหมาย\n- เพิ่มปุ่ม' };

describe('runAsk', () => {
  it('คุยต่อใน session เดิม, คำตอบเป็น kind advisor, /exit แล้วตอบ n ไม่เก็บไฟล์', async () => {
    const runner = new FakeAdvisor(['ตอบ 1', 'ตอบ 2']);
    const io = new ScriptedIO(['ถาม 1', 'ถาม 2', '/exit', 'n']);
    const store = newStore();
    expect(await runAsk({ runner, io, store, resume: false })).toEqual({ kind: 'exit' });
    expect(runner.calls.map((c) => c.sessionId)).toEqual([undefined, 's1']);
    const i = io.said.indexOf('\n[ADVISOR] ตอบ 1\n');
    expect(io.kinds[i]).toBe('advisor');
    expect(await store.list()).toEqual([]);
  });

  it('/exit ตอบ y -> เขียน handoff ของ session ล่าสุด', async () => {
    const runner = new FakeAdvisor(['ตอบ'], [H]);
    const store = newStore();
    await runAsk({ runner, io: new ScriptedIO(['ถาม', '/exit', 'y']), store, resume: false });
    expect(runner.calls[1]).toEqual({ kind: 'handoff', sessionId: 's1' });
    expect((await store.list()).map((h) => h.title)).toEqual(['เรื่อง export']);
  });

  it('/exit ก่อนคุย -> ออกเลยไม่ถาม', async () => {
    const io = new ScriptedIO(['/exit']);
    expect(await runAsk({ runner: new FakeAdvisor([]), io, store: newStore(), resume: false })).toEqual({ kind: 'exit' });
  });

  it('/save ก่อนคุย -> เตือนและไม่เรียก handoff', async () => {
    const runner = new FakeAdvisor([]);
    const io = new ScriptedIO(['/save', '/exit']);
    await runAsk({ runner, io, store: newStore(), resume: false });
    expect(runner.calls).toEqual([]);
    expect(io.kinds).toContain('warn');
  });

  it('/save หลังคุย -> เก็บไฟล์ และ /exit ไม่ถามซ้ำ', async () => {
    const store = newStore();
    const io = new ScriptedIO(['ถาม', '/save', '/exit']);
    await runAsk({ runner: new FakeAdvisor(['ตอบ'], [H]), io, store, resume: false });
    expect(await store.list()).toHaveLength(1);
    expect(io.said.some((t) => t.startsWith('เก็บ handoff ที่ '))).toBe(true);
  });

  it('/job ตอบ y -> คืน handoff ให้เปิดงาน (และเก็บไฟล์ไว้ด้วย)', async () => {
    const store = newStore();
    const io = new ScriptedIO(['ถาม', '/job', 'y']);
    expect(await runAsk({ runner: new FakeAdvisor(['ตอบ'], [H]), io, store, resume: false })).toEqual({
      kind: 'job',
      handoff: H,
    });
    expect(await store.list()).toHaveLength(1);
    expect(io.said).toContain(`\n[ADVISOR] # ${H.title}\n\n${H.markdown}\n`);
  });

  it('/job ตอบ n -> คุยต่อได้ แล้ว /exit ไม่ถามเพราะเพิ่งเก็บ', async () => {
    const io = new ScriptedIO(['ถาม', '/job', 'n', '/exit']);
    expect(await runAsk({ runner: new FakeAdvisor(['ตอบ'], [H]), io, store: newStore(), resume: false })).toEqual({
      kind: 'exit',
    });
  });

  it('advisor ล้ม -> error แล้วกด Enter ส่งข้อความเดิมซ้ำ', async () => {
    const runner = new FakeAdvisor([new Error('boom'), 'ตอบ']);
    const io = new ScriptedIO(['ถาม', '', '/exit', 'n']);
    await runAsk({ runner, io, store: newStore(), resume: false });
    expect(runner.calls.map((c) => c.prompt)).toEqual(['ถาม', 'ถาม']);
    expect(io.kinds).toContain('error');
  });

  it('Enter ว่างโดยไม่มีข้อความที่ล้ม -> ถามใหม่เฉย ๆ', async () => {
    const runner = new FakeAdvisor([]);
    await runAsk({ runner, io: new ScriptedIO(['', '/exit']), store: newStore(), resume: false });
    expect(runner.calls).toEqual([]);
  });

  it('คำสั่งที่ไม่รู้จัก -> เตือนและไม่ส่งให้ advisor', async () => {
    const runner = new FakeAdvisor([]);
    const io = new ScriptedIO(['/foo', '/exit']);
    await runAsk({ runner, io, store: newStore(), resume: false });
    expect(runner.calls).toEqual([]);
    expect(io.said.some((t) => t.includes('ไม่รู้จักคำสั่ง /foo'))).toBe(true);
  });

  it('handoff ล้ม -> แจ้ง error, ยังถือว่ายังไม่เก็บ จึงถามตอน /exit', async () => {
    const io = new ScriptedIO(['ถาม', '/save', '/exit', 'n']);
    await runAsk({ runner: new FakeAdvisor(['ตอบ'], [new Error('x')]), io, store: newStore(), resume: false });
    expect(io.said.some((t) => t.includes('เขียน handoff ไม่สำเร็จ'))).toBe(true);
    expect(io.asked.some((q) => q.startsWith('เก็บ handoff ของการคุยนี้ไหม?'))).toBe(true);
  });

  it('--resume: เลือก handoff แล้วข้อความแรกมี handoff เป็นบริบท ข้อความถัดไปไม่มี', async () => {
    const store = newStore();
    await store.save({ title: 'เก่า', markdown: 'เนื้อหาเก่า' });
    const runner = new FakeAdvisor(['ตอบ 1', 'ตอบ 2']);
    const io = new ScriptedIO(['1', 'ถามต่อ', 'ถามอีก', '/exit', 'n']);
    await runAsk({ runner, io, store, resume: true });
    expect(runner.calls[0]!.prompt).toContain('เนื้อหาเก่า');
    expect(runner.calls[0]!.prompt!.endsWith('ถามต่อ')).toBe(true);
    expect(runner.calls[1]!.prompt).toBe('ถามอีก');
  });

  it('--resume แต่ไม่มี handoff -> แจ้งแล้วเริ่มคุยใหม่', async () => {
    const io = new ScriptedIO(['/exit']);
    await runAsk({ runner: new FakeAdvisor([]), io, store: newStore(), resume: true });
    expect(io.said.some((t) => t.includes('ยังไม่มี handoff'))).toBe(true);
  });

  it('--resume ตอบว่าง -> เริ่มใหม่โดยไม่มีบริบท', async () => {
    const store = newStore();
    await store.save({ title: 'เก่า', markdown: 'เนื้อหาเก่า' });
    const runner = new FakeAdvisor(['ตอบ']);
    await runAsk({ runner, io: new ScriptedIO(['', 'ถาม', '/exit', 'n']), store, resume: true });
    expect(runner.calls[0]!.prompt).toBe('ถาม');
  });
});

describe('askJobPrompt', () => {
  it('บอก PM ว่ามาจากโหมดปรึกษา ตามด้วย title และเนื้อหา handoff', () => {
    const p = askJobPrompt(H);
    expect(p).toContain('agent-team ask');
    expect(p).toContain(`# ${H.title}\n\n${H.markdown}`);
  });
});
