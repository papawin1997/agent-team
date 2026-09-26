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

  it('startedAt ใน lock อ่านค่าวันที่ไม่ได้ถือว่าค้าง', async () => {
    const repo = make();
    const { id } = await repo.create();
    await fs.writeFile(repo.lockPath(id), JSON.stringify({ pid: 1000, startedAt: 'garbage' }), 'utf8');
    // pid 1000 ยังอยู่ (alive) แต่ startedAt พังจึงถือว่า lock ค้าง ไม่ใช่ยังทำงานอยู่
    expect(await make({ pid: 2000 }).lock(id)).toBe(true);
  });

  it('สอง process lock พร้อมกันได้ lock แค่ตัวเดียว (ไม่อ่านเจอไฟล์ lock ที่ยังเขียนไม่เสร็จ)', async () => {
    const a = make();
    const b = make({ pid: 2000 });
    alive.add(2000);
    const { id } = await a.create();
    for (let i = 0; i < 50; i++) {
      await a.unlock(id);
      await b.unlock(id);
      const results = await Promise.all([a.lock(id), b.lock(id)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    }
  });

  it('lock ไม่ทิ้งไฟล์ชั่วคราวไว้ในโฟลเดอร์งาน', async () => {
    const repo = make();
    const { id } = await repo.create();
    alive.add(2000);
    expect(await make({ pid: 2000 }).lock(id)).toBe(false);
    expect((await fs.readdir(repo.jobDir(id))).sort()).toEqual(['run.lock', 'state.json']);
  });

  it('lock บนโฟลเดอร์งานที่ถูกลบไปแล้วคืน false ไม่ throw', async () => {
    const repo = make();
    const { id } = await repo.create();
    await fs.rm(repo.jobDir(id), { recursive: true, force: true });
    await expect(repo.lock(id)).resolves.toBe(false);
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

  it('create ลบโฟลเดอร์งานทิ้งถ้า save state เริ่มต้นล้มเหลว', async () => {
    let calls = 0;
    // เรียก now() ครั้งที่ 1 = formatJobId, ครั้งที่ 2 = lock body, ครั้งที่ 3 = ใน store.save() ให้ throw
    const now = () => {
      calls += 1;
      if (calls > 2) throw new Error('now ล้มเหลว');
      return at;
    };
    const repo = new JobRepository(projectDir, { now, pid: 1000, isAlive: (pid) => alive.has(pid) });

    await expect(repo.create()).rejects.toThrow('now ล้มเหลว');

    expect(existsSync(path.join(projectDir, '.agent-team', 'jobs', '20260925-093015'))).toBe(false);
  });

  it('list ข้ามงานที่ run.lock อ่านไม่ได้ (เช่นเป็นโฟลเดอร์) แทนที่จะ throw', async () => {
    const events: string[] = [];
    const repo = make({ log: { log: (_level, event) => void events.push(event) } });
    const { id, store } = await repo.create();
    await store.save(buildState());
    await repo.unlock(id);
    await fs.mkdir(repo.lockPath(id));

    const jobs = await repo.list();

    expect(jobs).toEqual([]);
    expect(events).toContain('job.unreadable');
  });

  it('remove ลบทั้งโฟลเดอร์งาน', async () => {
    const repo = make();
    const { id, store } = await repo.create();
    await store.saveArtifact('design.json', {});
    await repo.remove(id);
    expect(existsSync(repo.jobDir(id))).toBe(false);
  });
});

describe('migrateLegacy', () => {
  const legacyAt = new Date(2026, 8, 20, 8, 0, 0);
  const legacyId = '20260920-080000';
  const allFiles = ['state.json', 'requirements.json', 'design.json', 'reports/api-round1.json'];

  async function writeLegacy(files: string[] = allFiles): Promise<string> {
    const root = path.join(projectDir, '.agent-team');
    for (const f of files) {
      const file = path.join(root, f);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const body = f === 'state.json' ? JSON.stringify(buildState()) : JSON.stringify({ file: f });
      await fs.writeFile(file, body, 'utf8');
    }
    if (files.includes('state.json')) await fs.utimes(path.join(root, 'state.json'), legacyAt, legacyAt);
    return root;
  }

  const failOn = (name: string, code: string) => async (from: string, to: string) => {
    if (from.endsWith(name)) throw Object.assign(new Error(`${code} ${name}`), { code });
    await fs.rename(from, to);
  };

  it('ย้าย state และ artifact ทั้งหมดเข้า jobs/<id จาก mtime>/ และไม่แตะ log', async () => {
    const root = await writeLegacy();
    await fs.writeFile(path.join(root, 'agent-team.log'), 'old log\n', 'utf8');
    const repo = make();

    await repo.migrateLegacy();

    const dir = path.join(root, 'jobs', legacyId);
    for (const f of allFiles) {
      expect(existsSync(path.join(dir, f))).toBe(true);
      expect(existsSync(path.join(root, f))).toBe(false);
    }
    expect(existsSync(path.join(root, 'agent-team.log'))).toBe(true);
    const jobs = await repo.list();
    expect(jobs.map((j) => j.id)).toEqual([legacyId]);
    expect(jobs[0]!.state.phase).toBe('BUILD');
  });

  it('ไม่มี legacy ก็ไม่ทำอะไร', async () => {
    await make().migrateLegacy();
    expect(existsSync(path.join(projectDir, '.agent-team', 'jobs'))).toBe(false);
  });

  it('ย้ายค้างครึ่งทางจากรอบก่อน: ใช้โฟลเดอร์เดิมต่อจนครบ ไม่ต่อท้าย -2', async () => {
    const root = await writeLegacy();
    const dir = path.join(root, 'jobs', legacyId);
    await fs.mkdir(dir, { recursive: true });
    await fs.rename(path.join(root, 'requirements.json'), path.join(dir, 'requirements.json'));

    await make().migrateLegacy();

    expect(await fs.readdir(path.join(root, 'jobs'))).toEqual([legacyId]);
    for (const f of allFiles) expect(existsSync(path.join(dir, f))).toBe(true);
  });

  it('rename ล้มกลางทาง: throw พร้อมชื่อไฟล์ state.json ยังอยู่ที่ root แล้วรอบถัดไปย้ายต่อได้', async () => {
    const root = await writeLegacy();

    await expect(make({ rename: failOn('design.json', 'EBUSY') }).migrateLegacy()).rejects.toThrow('design.json');
    expect(existsSync(path.join(root, 'state.json'))).toBe(true);

    await make().migrateLegacy();

    expect(await fs.readdir(path.join(root, 'jobs'))).toEqual([legacyId]);
    for (const f of allFiles) expect(existsSync(path.join(root, 'jobs', legacyId, f))).toBe(true);
    expect(existsSync(path.join(root, 'state.json'))).toBe(false);
  });

  it('rename ได้ ENOENT (อีก process ย้ายไปแล้ว): ข้ามไฟล์นั้นแล้วทำต่อ', async () => {
    const root = await writeLegacy();
    await make({ rename: failOn('design.json', 'ENOENT') }).migrateLegacy();
    expect(existsSync(path.join(root, 'jobs', legacyId, 'state.json'))).toBe(true);
  });

  it('artifact ค้างที่ root โดยไม่มี state.json: WARN และไม่ throw ไม่ย้าย', async () => {
    const events: string[] = [];
    const root = await writeLegacy(['design.json']);
    await make({ log: { log: (_level, event) => void events.push(event) } }).migrateLegacy();
    expect(events).toContain('job.legacy_leftover');
    expect(existsSync(path.join(root, 'design.json'))).toBe(true);
  });

  it('id ชนกับงานที่มี state.json อยู่แล้ว: ต่อท้าย -2', async () => {
    const root = await writeLegacy();
    const taken = path.join(root, 'jobs', legacyId);
    await fs.mkdir(taken, { recursive: true });
    await fs.writeFile(path.join(taken, 'state.json'), JSON.stringify(buildState()), 'utf8');

    await make().migrateLegacy();

    expect(existsSync(path.join(root, 'jobs', `${legacyId}-2`, 'state.json'))).toBe(true);
  });
});
