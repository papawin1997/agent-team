import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { JobRepository } from '../src/jobs';
import { countPendingJobs, selectProject } from '../src/project-menu';
import { ProjectRegistry } from '../src/projects';
import { newState } from '../src/state';
import { ScriptedIO } from './helpers/fakes';

let dir: string;
let clock: Date;
let registry: ProjectRegistry;
const pending = new Map<string, number>();
const teamRoot = () => path.join(dir, 'agent-team');

function run(answers: string[], countPending = async (p: string) => pending.get(p) ?? 0) {
  const io = new ScriptedIO(answers);
  return { io, result: selectProject({ registry, io, teamRoot: teamRoot(), countPending }) };
}

async function addProject(name: string, at: Date, create = true): Promise<string> {
  const p = path.join(dir, name);
  if (create) await fs.mkdir(p, { recursive: true });
  clock = at;
  await registry.touch(p);
  return p;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-projmenu-'));
  clock = new Date(2026, 8, 26, 9, 0);
  registry = new ProjectRegistry(path.join(dir, 'home', 'projects.json'), { now: () => clock });
  pending.clear();
});

describe('selectProject', () => {
  it('แสดงรายการ (ใช้ล่าสุดก่อน, งานค้าง, ⚠ โฟลเดอร์หาย) แล้วเลือกเลขได้ path', async () => {
    const shop = await addProject('shop', new Date(2026, 8, 25, 10, 0));
    await addProject('blog', new Date(2026, 8, 26, 8, 30));
    await addProject('gone', new Date(2026, 8, 24, 7, 0), false);
    pending.set(shop, 2);
    const { io, result } = run(['2']);
    expect(await result).toBe(shop);
    const menu = io.said[0]!;
    expect(menu).toContain('1) blog');
    expect(menu).toContain('2) shop');
    expect(menu).toContain('งานค้าง 2 · ใช้ล่าสุด 2026-09-25 10:00');
    expect(menu).toMatch(/3\) gone .*⚠ ไม่พบโฟลเดอร์/);
  });

  it('ยังไม่มีโปรเจกต์ในรายชื่อ -> ถาม root path ทันที', async () => {
    const app = path.join(dir, 'app');
    await fs.mkdir(app);
    const { io, result } = run([app]);
    expect(await result).toBe(app);
    expect(io.asked[0]).toContain('root path');
  });

  it('รายชื่อว่างแล้วตอบว่าง -> ออก (undefined)', async () => {
    const { result } = run(['']);
    expect(await result).toBeUndefined();
  });

  it('n + path ที่ยังไม่มี + ตอบ y -> สร้างโฟลเดอร์แล้วคืน path', async () => {
    await addProject('shop', clock);
    const fresh = path.join(dir, 'new', 'app');
    const { result } = run(['n', fresh, 'y']);
    expect(await result).toBe(fresh);
    expect(existsSync(fresh)).toBe(true);
  });

  it('ตอบ n ไม่สร้าง -> ถาม path ใหม่ ตอบว่าง = กลับเมนู', async () => {
    await addProject('shop', clock);
    const fresh = path.join(dir, 'nope');
    const { result } = run(['n', fresh, 'n', '', 'q']);
    expect(await result).toBeUndefined();
    expect(existsSync(fresh)).toBe(false);
  });

  it('path ที่ครอบด้วยเครื่องหมายคำพูด (Copy as path ของ Windows) ใช้ได้', async () => {
    const app = path.join(dir, 'app');
    await fs.mkdir(app);
    const { result } = run([`"${app}"`]);
    expect(await result).toBe(app);
  });

  it('path คือ repo agent-team -> แจ้ง error แล้วถามใหม่', async () => {
    await fs.mkdir(teamRoot());
    const { io, result } = run([teamRoot(), '']);
    expect(await result).toBeUndefined();
    expect(io.said.join('\n')).toContain('ห้ามใช้ repo agent-team');
  });

  it('path เป็นไฟล์ -> แจ้งว่าไม่ใช่โฟลเดอร์', async () => {
    const f = path.join(dir, 'file.txt');
    await fs.writeFile(f, 'x');
    const { io, result } = run([f, '']);
    expect(await result).toBeUndefined();
    expect(io.said.join('\n')).toContain('ไม่ใช่โฟลเดอร์');
  });

  it('เลือกโปรเจกต์ที่โฟลเดอร์หาย -> เตือนแล้วกลับเมนู', async () => {
    await addProject('gone', clock, false);
    const { io, result } = run(['1', 'q']);
    expect(await result).toBeUndefined();
    expect(io.said.join('\n')).toContain('d1');
  });

  it('d<เลข> เอาออกจากรายชื่อ แต่ไม่ลบโฟลเดอร์', async () => {
    const shop = await addProject('shop', clock);
    const { result } = run(['d1', '']);
    expect(await result).toBeUndefined();
    expect(await registry.list()).toEqual([]);
    expect(existsSync(shop)).toBe(true);
  });

  it('พิมพ์ผิด -> บอกวิธีใช้แล้วถามใหม่', async () => {
    const shop = await addProject('shop', clock);
    const { io, result } = run(['x', '9', '1']);
    expect(await result).toBe(shop);
    expect(io.said.filter((s) => s.includes('เลือกไม่ถูกต้อง'))).toHaveLength(2);
  });

  it('นับงานค้างไม่ได้ -> แสดง ? แทน ไม่ทำให้เมนูล้ม', async () => {
    await addProject('shop', clock);
    const { io, result } = run(['q'], async () => {
      throw new Error('boom');
    });
    expect(await result).toBeUndefined();
    expect(io.said[0]).toContain('งานค้าง ?');
  });
});

describe('countPendingJobs', () => {
  it('นับเฉพาะงานค้างใน .agent-team/jobs และโปรเจกต์ที่ไม่มีงาน = 0', async () => {
    const app = path.join(dir, 'app');
    await fs.mkdir(app);
    const repo = new JobRepository(app);
    const { id, store } = await repo.create();
    const s = newState();
    s.title = 'งานทดสอบ';
    await store.save(s);
    await repo.unlock(id);
    expect(await countPendingJobs(app)).toBe(1);
    expect(await countPendingJobs(path.join(dir, 'none'))).toBe(0);
  });
});
