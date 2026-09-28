import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStateStore, newState } from '../src/state';
import { buildState } from './helpers/builders';

let jobDir: string;
const fixed = new Date('2026-09-25T02:30:00.000Z');
const clock = () => fixed;

beforeEach(async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-'));
  jobDir = path.join(tmp, '.agent-team', 'jobs', 'job-1');
});

describe('FileStateStore', () => {
  it('load คืน undefined เมื่อยังไม่มี state', async () => {
    expect(await new FileStateStore(jobDir).load()).toBeUndefined();
  });

  it('save แล้ว load ได้ข้อมูลเดิม', async () => {
    const store = new FileStateStore(jobDir);
    const state = newState();
    state.phase = 'BUILD';
    state.pmSessionId = 'abc';
    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  it('save เขียนที่ <jobDir>/state.json', async () => {
    await new FileStateStore(jobDir).save(newState());
    const raw = await fs.readFile(path.join(jobDir, 'state.json'), 'utf8');
    expect(JSON.parse(raw).version).toBe(1);
  });

  it('saveArtifact สร้างโฟลเดอร์ย่อยใต้โฟลเดอร์งานให้อัตโนมัติ', async () => {
    await new FileStateStore(jobDir).saveArtifact('reports/api-round1.json', { ok: true });
    const raw = await fs.readFile(path.join(jobDir, 'reports', 'api-round1.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  it('load ปฏิเสธ state ที่ version ไม่ตรง', async () => {
    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(path.join(jobDir, 'state.json'), JSON.stringify({ version: 99 }), 'utf8');
    await expect(new FileStateStore(jobDir).load()).rejects.toThrow('version');
  });

  it('save ตั้ง updatedAt จากนาฬิกาทุกครั้ง', async () => {
    const store = new FileStateStore(jobDir, clock);
    const state = newState();
    await store.save(state);
    expect(state.updatedAt).toBe('2026-09-25T02:30:00.000Z');
    expect((await store.load())?.updatedAt).toBe('2026-09-25T02:30:00.000Z');
  });

  it('lastBuildAt ไม่ถูกตั้งตอนเพิ่งเข้า BUILD (ยังไม่มีรอบ)', async () => {
    const state = buildState();
    await new FileStateStore(jobDir, clock).save(state);
    expect(state.lastBuildAt).toBeUndefined();
  });

  it('lastBuildAt ถูกตั้งเมื่ออยู่ BUILD และมี rounds > 0', async () => {
    const state = buildState();
    state.progress.api!.rounds = 1;
    await new FileStateStore(jobDir, clock).save(state);
    expect(state.lastBuildAt).toBe('2026-09-25T02:30:00.000Z');
  });

  it('นอกเฟส BUILD ไม่แตะ lastBuildAt เดิม', async () => {
    const state = buildState();
    state.progress.api!.rounds = 2;
    state.phase = 'DELIVER';
    state.lastBuildAt = '2026-09-01T00:00:00.000Z';
    await new FileStateStore(jobDir, clock).save(state);
    expect(state.lastBuildAt).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('FileStateStore.save rename บน Windows', () => {
  const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

  it('rename ล้มด้วย EPERM ชั่วคราว (อีก process เปิด state.json อ่านอยู่) → retry แล้ว save สำเร็จ', async () => {
    let fails = 3;
    const rename = vi.fn(async (from: string, to: string) => {
      if (fails-- > 0) throw errno('EPERM');
      await fs.rename(from, to);
    });
    const store = new FileStateStore(jobDir, clock, { rename });
    const state = newState();
    await store.save(state);
    expect(rename).toHaveBeenCalledTimes(4);
    expect(await store.load()).toEqual(state);
  });

  it('rename ล้มตลอด → throw และไม่ทิ้ง state.json.tmp', async () => {
    const rename = vi.fn(async () => {
      throw errno('EPERM');
    });
    const store = new FileStateStore(jobDir, clock, { rename });
    await expect(store.save(newState())).rejects.toThrow('EPERM');
    expect(await fs.readdir(jobDir)).toEqual([]);
  });
});
