import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  headlessPath,
  readEvents,
  readJsonSafe,
  writeJsonAtomic,
  type Activity,
  type Question,
} from '../../src/headless/files';
import { ActivityStatus, HeadlessIdleError, HeadlessIO } from '../../src/headless/io';
import { until } from '../helpers/until';

let dir: string;
let ids: number;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-headless-io-'));
  ids = 0;
});

const make = (idleTimeoutMs = 2000) =>
  new HeadlessIO({ dir, idleTimeoutMs, pollMs: 5, newId: () => `q${++ids}` });

const question = () => until(() => readJsonSafe<Question>(headlessPath(dir, 'question')));
const reply = (q: Question, text: string) =>
  writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: q.id, text });

describe('HeadlessIO', () => {
  it('say ต่อท้าย events.jsonl ด้วย seq ที่ต่อจากของเดิม', () => {
    appendEvent(dir, { seq: 7, at: 't', text: 'เก่า' });
    const io = make();
    expect(io.lastSeq).toBe(7);
    io.say('ใหม่');
    expect(io.lastSeq).toBe(8);
    expect(readEvents(dir, 7)).toEqual([expect.objectContaining({ seq: 8, text: 'ใหม่' })]);
  });

  it('constructor สร้าง events.jsonl ว่าง และลบคำถาม/คำตอบค้าง', () => {
    writeJsonAtomic(headlessPath(dir, 'question'), { id: 'old' });
    writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: 'old', text: 'x' });
    make();
    expect(fs.existsSync(headlessPath(dir, 'events'))).toBe(true);
    expect(fs.existsSync(headlessPath(dir, 'question'))).toBe(false);
    expect(fs.existsSync(headlessPath(dir, 'answer'))).toBe(false);
  });

  it('ask: เขียน question แบบ text แล้วคืนคำตอบที่ questionId ตรง และลบทั้งสองไฟล์', async () => {
    const io = make();
    const pending = io.ask('คุณอยากได้อะไร?');
    const q = await question();
    expect(q).toMatchObject({ id: 'q1', kind: 'text', prompt: 'คุณอยากได้อะไร?' });
    expect(q).not.toHaveProperty('options');
    reply(q, 'ระบบ todo');
    await expect(pending).resolves.toBe('ระบบ todo');
    expect(fs.existsSync(headlessPath(dir, 'question'))).toBe(false);
    expect(fs.existsSync(headlessPath(dir, 'answer'))).toBe(false);
  });

  it('ไม่สนคำตอบที่ questionId ไม่ตรง', async () => {
    const io = make();
    const pending = io.ask('?');
    const q = await question();
    writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: 'other', text: 'ผิด' });
    await new Promise((r) => setTimeout(r, 30));
    reply(q, 'ถูก');
    await expect(pending).resolves.toBe('ถูก');
  });

  it('chooseOrText: ตัวเลือก (รวมเลขลำดับ) คืน option, ข้อความอื่นคืน { text }', async () => {
    const io = make();
    const first = io.chooseOrText('ยืนยันไหม?', ['confirm', 'revise'] as const);
    const q1 = await question();
    expect(q1).toMatchObject({ kind: 'choiceOrText', options: ['confirm', 'revise'] });
    reply(q1, '2');
    await expect(first).resolves.toBe('revise');

    const second = io.chooseOrText('ยืนยันไหม?', ['confirm', 'revise'] as const);
    const q2 = await until(() => {
      const q = readJsonSafe<Question>(headlessPath(dir, 'question'));
      return q?.id === 'q2' ? q : undefined;
    });
    reply(q2, 'ทำไมต้องมี login?');
    await expect(second).resolves.toEqual({ text: 'ทำไมต้องมี login?' });
  });

  it('choose: คำตอบไม่อยู่ในตัวเลือกจะ say แจ้งแล้วถามใหม่', async () => {
    const io = make();
    const pending = io.choose('เลือก', ['a', 'b'] as const);
    reply(await question(), 'zzz');
    const q2 = await until(() => {
      const q = readJsonSafe<Question>(headlessPath(dir, 'question'));
      return q?.id === 'q2' ? q : undefined;
    });
    expect(q2.kind).toBe('choice');
    reply(q2, 'b');
    await expect(pending).resolves.toBe('b');
    expect(readEvents(dir).map((e) => e.text).join('\n')).toContain('zzz');
  });

  it('ไม่มีคำตอบเกิน idleTimeoutMs → HeadlessIdleError และลบคำถามทิ้ง', async () => {
    const io = make(40);
    await expect(io.ask('?')).rejects.toBeInstanceOf(HeadlessIdleError);
    expect(fs.existsSync(headlessPath(dir, 'question'))).toBe(false);
  });
});

describe('ActivityStatus', () => {
  it('ก่อน attach ไม่เขียนอะไร; start/update เขียน activity.json; stop ลบทิ้ง', () => {
    const status = new ActivityStatus(() => new Date('2026-09-28T00:00:00Z'));
    status.start('[qa] ตรวจ api');
    expect(fs.existsSync(headlessPath(dir, 'activity'))).toBe(false);

    status.attach(dir);
    status.start('[qa] ตรวจ api');
    expect(readJsonSafe<Activity>(headlessPath(dir, 'activity'))).toEqual({
      label: '[qa] ตรวจ api',
      at: '2026-09-28T00:00:00.000Z',
    });
    status.update('Bash: npm test');
    expect(readJsonSafe<Activity>(headlessPath(dir, 'activity'))?.detail).toBe('Bash: npm test');
    status.stop();
    expect(fs.existsSync(headlessPath(dir, 'activity'))).toBe(false);
  });

  it('update โดยไม่มี start ไม่เขียนไฟล์', () => {
    const status = new ActivityStatus();
    status.attach(dir);
    status.update('x');
    expect(fs.existsSync(headlessPath(dir, 'activity'))).toBe(false);
  });
});
