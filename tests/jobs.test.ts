import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatJobId,
  isEmptyJob,
  isProcessAlive,
  JobRepository,
  type JobRepositoryOptions,
} from '../src/jobs';
import { newState } from '../src/state';
import { buildState } from './helpers/builders';

let projectDir: string;
const at = new Date(2026, 8, 25, 9, 30, 15);
const alive = new Set<number>();
const make = (opts: JobRepositoryOptions = {}) =>
  new JobRepository(projectDir, { now: () => at, pid: 1000, isAlive: (pid) => alive.has(pid), ...opts });

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-jobs-'));
  alive.clear();
  alive.add(1000);
});

describe('formatJobId', () => {
  it('ใช้เวลาท้องถิ่นรูปแบบ YYYYMMDD-HHmmss', () => {
    expect(formatJobId(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });
});

describe('isProcessAlive', () => {
  it('process ตัวเองยังอยู่', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('process ที่จบไปแล้วไม่อยู่', () => {
    const child = spawnSync(process.execPath, ['-e', '']);
    expect(isProcessAlive(child.pid!)).toBe(false);
  });
});

describe('isEmptyJob', () => {
  it('งานใหม่ที่ยังไม่มีอะไรเลยเป็นงานเปล่า', () => {
    expect(isEmptyJob(newState())).toBe(true);
  });

  it('มี title หรือ pmSessionId แล้วไม่ใช่งานเปล่า', () => {
    const titled = newState();
    titled.title = 'x';
    const talked = newState();
    talked.pmSessionId = 's';
    expect(isEmptyJob(titled)).toBe(false);
    expect(isEmptyJob(talked)).toBe(false);
  });

  it('เฟสอื่นไม่ใช่งานเปล่า', () => {
    expect(isEmptyJob(buildState())).toBe(false);
  });
});

describe('JobRepository', () => {
  it('create สร้างโฟลเดอร์งาน, lock และ state.json เริ่มต้น', async () => {
    const repo = make();
    const { id } = await repo.create();
    expect(id).toBe('20260925-093015');
    const dir = path.join(projectDir, '.agent-team', 'jobs', id);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8')).phase).toBe('REQUIREMENTS');
    expect(JSON.parse(await fs.readFile(path.join(dir, 'run.lock'), 'utf8'))).toEqual({
      pid: 1000,
      startedAt: at.toISOString(),
    });
  });

  it('create ในวินาทีเดียวกันได้ id ไม่ซ้ำ', async () => {
    const repo = make();
    const ids = [(await repo.create()).id, (await repo.create()).id, (await repo.create()).id];
    expect(ids).toEqual(['20260925-093015', '20260925-093015-2', '20260925-093015-3']);
  });

  it('list คืนงานพร้อม updatedAt และข้ามโฟลเดอร์ที่ไม่มี/อ่าน state ไม่ได้', async () => {
    const events: string[] = [];
    const repo = make({ log: { log: (_level, event) => void events.push(event) } });
    const { id, store } = await repo.create();
    await store.save(buildState());
    await fs.mkdir(path.join(repo.jobsDir, 'no-state'));
    await fs.mkdir(path.join(repo.jobsDir, 'broken'));
    await fs.writeFile(path.join(repo.jobsDir, 'broken', 'state.json'), '{bad', 'utf8');

    const jobs = await repo.list();

    expect(jobs.map((j) => j.id)).toEqual([id]);
    expect(jobs[0]!.state.phase).toBe('BUILD');
    expect(jobs[0]!.updatedAt.getTime()).toBe(at.getTime());
    expect(events).toEqual(expect.arrayContaining(['job.missing_state', 'job.unreadable']));
  });

  it('list คืน [] เมื่อยังไม่มีโฟลเดอร์ jobs', async () => {
    expect(await make().list()).toEqual([]);
  });

  it('list แสดง lock เฉพาะเมื่อ process ที่ถือยังอยู่', async () => {
    const repo = make();
    const { id } = await repo.create();
    expect((await repo.list())[0]!.lock).toEqual({ pid: 1000, startedAt: at.toISOString() });

    await repo.unlock(id);
    alive.add(2000);
    expect(await make({ pid: 2000 }).lock(id)).toBe(true);
    expect((await repo.list())[0]!.lock?.pid).toBe(2000);

    alive.delete(2000);
    expect((await repo.list())[0]!.lock).toBeUndefined();
  });

  it('lock ไม่ได้ถ้า process อื่นที่ยังอยู่ถือ lock', async () => {
    const { id } = await make().create();
    alive.add(2000);
    expect(await make({ pid: 2000 }).lock(id)).toBe(false);
  });

  it('lock ซ้ำโดย process เดิมสำเร็จ', async () => {
    const repo = make();
    const { id } = await repo.create();
    expect(await repo.lock(id)).toBe(true);
  });

  it('lock ค้างจาก pid ที่ตายแล้วถูกลบแล้วได้ lock ใหม่', async () => {
    const repo = make();
    const { id } = await repo.create();
    alive.delete(1000);
    expect(await make({ pid: 2000 }).lock(id)).toBe(true);
    expect(JSON.parse(await fs.readFile(repo.lockPath(id), 'utf8')).pid).toBe(2000);
  });

  it('ไฟล์ lock พังถือว่าค้าง', async () => {
    const repo = make();
    const { id } = await repo.create();
    await fs.writeFile(repo.lockPath(id), 'garbage', 'utf8');
    expect(await make({ pid: 2000 }).lock(id)).toBe(true);
  });

  it('unlock/unlockSync ลบเฉพาะ lock ของตัวเอง', async () => {
    const repo = make();
    const { id } = await repo.create();
    const other = make({ pid: 2000 });

    await other.unlock(id);
    other.unlockSync(id);
    expect(existsSync(repo.lockPath(id))).toBe(true);

    repo.unlockSync(id);
    expect(existsSync(repo.lockPath(id))).toBe(false);

    await repo.lock(id);
    await repo.unlock(id);
    expect(existsSync(repo.lockPath(id))).toBe(false);
  });

  it('unlock ไม่ throw เมื่อไม่มีไฟล์ lock', async () => {
    const repo = make();
    const { id } = await repo.create();
    await repo.unlock(id);
    await expect(repo.unlock(id)).resolves.toBeUndefined();
    expect(() => repo.unlockSync(id)).not.toThrow();
  });

  it('remove ลบทั้งโฟลเดอร์งาน', async () => {
    const repo = make();
    const { id, store } = await repo.create();
    await store.saveArtifact('design.json', {});
    await repo.remove(id);
    expect(existsSync(repo.jobDir(id))).toBe(false);
  });
});
