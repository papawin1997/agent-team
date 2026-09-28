import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendEvent, headlessPath, writeExit, writeJsonAtomic } from '../../src/headless/files';
import { DEFAULT_TAIL, readStatus, resolveJob, waitForStatus } from '../../src/headless/status';
import { JobRepository } from '../../src/jobs';

let projectDir: string;
const alive = new Set<number>();
const owner = () => new JobRepository(projectDir, { pid: 1000, isAlive: (p) => alive.has(p) });
const viewer = () => new JobRepository(projectDir, { pid: 2000, isAlive: (p) => alive.has(p) });

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-status-'));
  alive.clear();
  alive.add(1000);
});

/** งาน headless ที่ process 1000 ถือ lock อยู่ (มี events.jsonl) */
async function headlessJob(): Promise<{ id: string; dir: string }> {
  const repo = owner();
  const { id } = await repo.create();
  const dir = repo.jobDir(id);
  fs.appendFileSync(headlessPath(dir, 'events'), '');
  return { id, dir };
}

describe('readStatus', () => {
  it('lock อยู่ + มีคำถามยังไม่ตอบ → question พร้อม messages และ lastSeq', async () => {
    const { id, dir } = await headlessJob();
    appendEvent(dir, { seq: 1, at: 't', text: 'สรุป requirements' });
    writeJsonAtomic(headlessPath(dir, 'question'), { id: 'q1', kind: 'choiceOrText', prompt: 'ยืนยันไหม?', options: ['confirm', 'revise'], askedAt: 't' });
    const report = await readStatus(viewer(), id, 0);
    expect(report).toMatchObject({ jobId: id, status: 'question', phase: 'REQUIREMENTS', messages: ['สรุป requirements'], lastSeq: 1 });
    expect(report.question?.id).toBe('q1');
  });

  it('มี answer.json รอ process อ่าน → running และแนบ activity', async () => {
    const { id, dir } = await headlessJob();
    writeJsonAtomic(headlessPath(dir, 'question'), { id: 'q1', kind: 'text', prompt: '?', askedAt: 't' });
    writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: 'q1', text: 'x' });
    writeJsonAtomic(headlessPath(dir, 'activity'), { label: '[qa] ตรวจ api', at: 't' });
    const report = await readStatus(viewer(), id, 0);
    expect(report.status).toBe('running');
    expect(report.question).toBeUndefined();
    expect(report.activity?.label).toBe('[qa] ตรวจ api');
  });

  it('answer.json ค้างของคำถามก่อน (questionId ไม่ตรง) หรือ JSON พัง → ยังเป็น question', async () => {
    const { id, dir } = await headlessJob();
    writeJsonAtomic(headlessPath(dir, 'question'), { id: 'q2', kind: 'text', prompt: '?', askedAt: 't' });
    writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: 'q1', text: 'เก่า' });
    expect((await readStatus(viewer(), id, 0)).status).toBe('question');
    fs.writeFileSync(headlessPath(dir, 'answer'), '{พัง', 'utf8');
    expect((await readStatus(viewer(), id, 0)).status).toBe('question');
  });

  it('since กรองข้อความ และ lastSeq ไม่ต่ำกว่า since เมื่อไม่มีข้อความใหม่', async () => {
    const { id, dir } = await headlessJob();
    appendEvent(dir, { seq: 1, at: 't', text: 'a' });
    appendEvent(dir, { seq: 2, at: 't', text: 'b' });
    expect((await readStatus(viewer(), id, 1)).messages).toEqual(['b']);
    expect(await readStatus(viewer(), id, 2)).toMatchObject({ messages: [], lastSeq: 2 });
  });

  it('ไม่ส่ง since → เอาแค่ DEFAULT_TAIL ข้อความท้ายและบอก truncated', async () => {
    const { id, dir } = await headlessJob();
    for (let i = 1; i <= DEFAULT_TAIL + 5; i++) appendEvent(dir, { seq: i, at: 't', text: `m${i}` });
    const report = await readStatus(viewer(), id);
    expect(report.messages).toHaveLength(DEFAULT_TAIL);
    expect(report.messages.at(-1)).toBe(`m${DEFAULT_TAIL + 5}`);
    expect(report.truncated).toBe(true);
    expect(report.lastSeq).toBe(DEFAULT_TAIL + 5);
  });

  it('lock ไม่อยู่: phase DONE → done', async () => {
    const { id } = await headlessJob();
    const store = owner().store(id);
    const state = (await store.load())!;
    state.phase = 'DONE';
    await store.save(state);
    alive.delete(1000);
    expect((await readStatus(viewer(), id, 0)).status).toBe('done');
  });

  it('lock ไม่อยู่ + exit.json → status และ message จากไฟล์', async () => {
    const { id, dir } = await headlessJob();
    writeExit(dir, 'idle', 'รอคำตอบเกิน 120 นาที');
    alive.delete(1000);
    expect(await readStatus(viewer(), id, 0)).toMatchObject({ status: 'idle', message: 'รอคำตอบเกิน 120 นาที' });
  });

  it('lock ไม่อยู่และไม่มี exit.json → dead พร้อมวิธีทำต่อ', async () => {
    const { id } = await headlessJob();
    alive.delete(1000);
    const report = await readStatus(viewer(), id, 0);
    expect(report.status).toBe('dead');
    expect(report.message).toContain(`--job ${id}`);
  });

  it('ไม่มี state → throw', async () => {
    await expect(readStatus(viewer(), '20260101-000000', 0)).rejects.toThrow('ไม่พบงาน');
  });
});

describe('waitForStatus', () => {
  it('รอจนมีคำถามแล้วคืนทันที', async () => {
    const { id, dir } = await headlessJob();
    setTimeout(() => writeJsonAtomic(headlessPath(dir, 'question'), { id: 'q1', kind: 'text', prompt: '?', askedAt: 't' }), 30);
    const report = await waitForStatus(viewer(), id, { since: 0, timeoutMs: 2000, pollMs: 5 });
    expect(report.status).toBe('question');
  });

  it('ครบ timeout ยังทำงานอยู่ → คืน running', async () => {
    const { id } = await headlessJob();
    const report = await waitForStatus(viewer(), id, { since: 0, timeoutMs: 30, pollMs: 5 });
    expect(report.status).toBe('running');
  });

  it('timeoutMs = 0 อ่านครั้งเดียว (status)', async () => {
    const { id } = await headlessJob();
    let slept = 0;
    await waitForStatus(viewer(), id, { timeoutMs: 0, sleep: async () => void slept++ });
    expect(slept).toBe(0);
  });
});

describe('resolveJob', () => {
  it('--job: ตรวจรูปแบบและต้องมีโฟลเดอร์', async () => {
    const { id } = await headlessJob();
    expect(await resolveJob(viewer(), id)).toBe(id);
    await expect(resolveJob(viewer(), '../etc')).rejects.toThrow('jobId ไม่ถูกรูปแบบ');
    await expect(resolveJob(viewer(), '20260101-000000')).rejects.toThrow('ไม่พบงาน');
  });

  it('ไม่ระบุ: งาน headless ที่รันอยู่งานเดียว (ข้ามงานที่ไม่ใช่ headless)', async () => {
    await owner().create(); // งานโต้ตอบ ไม่มี events.jsonl
    const { id } = await headlessJob();
    expect(await resolveJob(viewer())).toBe(id);
  });

  it('ไม่ระบุและรันอยู่หลายงาน → throw พร้อมรายชื่อ', async () => {
    const a = await headlessJob();
    const b = await headlessJob();
    await expect(resolveJob(viewer())).rejects.toThrow(new RegExp(`${a.id}.*${b.id}|${b.id}.*${a.id}`));
  });

  it('ไม่มีงานรันอยู่: runningOnly → undefined, ไม่งั้นคืนงาน headless ล่าสุด', async () => {
    const { id } = await headlessJob();
    alive.delete(1000);
    expect(await resolveJob(viewer(), undefined, { runningOnly: true })).toBeUndefined();
    expect(await resolveJob(viewer())).toBe(id);
  });

  it('ไม่มีงาน headless เลย → throw', async () => {
    await expect(resolveJob(viewer())).rejects.toThrow('ไม่พบงาน headless');
  });
});
