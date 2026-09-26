import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectRegistry, samePath, teamRootError } from '../src/projects';

let dir: string;
let file: string;
let clock: Date;
let warnings: string[];
const registry = () => new ProjectRegistry(file, { now: () => clock, warn: (m) => warnings.push(m) });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-projects-'));
  file = path.join(dir, 'home', 'projects.json');
  clock = new Date('2026-09-26T05:00:00Z');
  warnings = [];
});

describe('ProjectRegistry', () => {
  it('ยังไม่มีไฟล์ -> รายการว่าง', async () => {
    expect(await registry().list()).toEqual([]);
  });

  it('touch เพิ่มโปรเจกต์ (สร้างโฟลเดอร์ของไฟล์ให้) และเรียงที่ใช้ล่าสุดก่อน', async () => {
    const r = registry();
    await r.touch(path.join(dir, 'a'));
    clock = new Date('2026-09-26T06:00:00Z');
    await r.touch(path.join(dir, 'b'));
    expect(await r.list()).toEqual([
      { path: path.join(dir, 'b'), lastUsedAt: '2026-09-26T06:00:00.000Z' },
      { path: path.join(dir, 'a'), lastUsedAt: '2026-09-26T05:00:00.000Z' },
    ]);
  });

  it('touch โปรเจกต์เดิมซ้ำ -> อัปเดตเวลา ไม่เพิ่มแถวซ้ำ', async () => {
    const r = registry();
    await r.touch(path.join(dir, 'a'));
    clock = new Date('2026-09-27T00:00:00Z');
    await r.touch(path.join(dir, 'a'));
    expect(await r.list()).toEqual([{ path: path.join(dir, 'a'), lastUsedAt: '2026-09-27T00:00:00.000Z' }]);
  });

  it('แปลง path เป็น absolute ก่อนเก็บ', async () => {
    const r = registry();
    await r.touch('rel/x');
    expect((await r.list())[0]!.path).toBe(path.resolve('rel/x'));
  });

  it.runIf(process.platform === 'win32')('Windows: path ต่างตัวพิมพ์ใหญ่เล็กคือโปรเจกต์เดียวกัน', async () => {
    const r = registry();
    await r.touch(path.join(dir, 'Proj'));
    await r.touch(path.join(dir, 'proj'));
    expect(await r.list()).toHaveLength(1);
    expect(samePath(path.join(dir, 'Proj'), path.join(dir, 'PROJ'))).toBe(true);
  });

  it('remove เอาออกจากรายการ แต่ไม่แตะโฟลเดอร์จริง', async () => {
    const a = path.join(dir, 'a');
    await fs.mkdir(a);
    const r = registry();
    await r.touch(a);
    await r.remove(a);
    expect(await r.list()).toEqual([]);
    expect(existsSync(a)).toBe(true);
  });

  it('ไฟล์ JSON เสีย -> ย้ายเป็น .bak, เตือน แล้วเริ่มรายการใหม่', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{broken');
    expect(await registry().list()).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('.bak');
    expect(await fs.readFile(`${file}.bak`, 'utf8')).toBe('{broken');
    expect(existsSync(file)).toBe(false);
  });

  it('โครงสร้างไม่ตรง schema ถือว่าเสีย', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 2, projects: [] }));
    expect(await registry().list()).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('เขียนแบบ atomic: ไม่เหลือไฟล์ .tmp', async () => {
    await registry().touch(path.join(dir, 'a'));
    expect(await fs.readdir(path.dirname(file))).toEqual(['projects.json']);
  });
});

describe('teamRootError', () => {
  const root = path.resolve('/team/agent-team');

  it('path คือ repo agent-team หรืออยู่ข้างใน -> ข้อความ error', () => {
    expect(teamRootError(root, root)).toContain('agent-team');
    expect(teamRootError(path.join(root, 'src'), root)).toBeDefined();
  });

  it('path อื่น (รวมโฟลเดอร์ชื่อคล้ายกัน) -> undefined', () => {
    expect(teamRootError(path.resolve('/team/agent-team-app'), root)).toBeUndefined();
    expect(teamRootError(path.resolve('/other'), root)).toBeUndefined();
  });
});
