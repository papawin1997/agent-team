import { existsSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectJob } from '../src/job-menu';
import { JobRepository } from '../src/jobs';
import { newState, type State } from '../src/state';
import { buildState } from './helpers/builders';
import { ScriptedIO } from './helpers/fakes';

let projectDir: string;
let clock: Date;
const alive = new Set<number>();
const repoFor = (pid: number) =>
  new JobRepository(projectDir, { now: () => clock, pid, isAlive: (p) => alive.has(p) });
const d = (day: number, hour: number) => new Date(2026, 8, day, hour, 0, 0);

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-menu-'));
  clock = d(26, 12);
  alive.clear();
  alive.add(1000);
});

/** สร้างงานค้างที่ไม่มีใครถือ lock โดย updatedAt = at */
async function seed(title: string, at: Date, edit: (s: State) => void = () => {}): Promise<string> {
  clock = at;
  const setup = repoFor(9999);
  const { id, store } = await setup.create();
  const s = newState();
  s.title = title;
  edit(s);
  await store.save(s);
  await setup.unlock(id);
  clock = d(26, 12);
  return id;
}

const lockHolder = (repo: JobRepository, id: string): number =>
  (JSON.parse(readFileSync(repo.lockPath(id), 'utf8')) as { pid: number }).pid;

class HookIO extends ScriptedIO {
  constructor(answers: string[], private readonly beforeAsk: (index: number) => Promise<void>) {
    super(answers);
  }
  override async ask(prompt: string): Promise<string> {
    await this.beforeAsk(this.asked.length);
    return super.ask(prompt);
  }
}

describe('selectJob', () => {
  it('ไม่มีงานค้าง: สร้างงานใหม่เลยโดยไม่ถาม', async () => {
    clock = d(26, 12);
    const repo = repoFor(1000);
    const io = new ScriptedIO([]);

    const job = await selectJob(repo, io, { resume: false });

    expect((await repo.list()).map((j) => j.id)).toEqual([job.id]);
    expect(io.asked).toHaveLength(0);
    expect((await job.store.load())?.phase).toBe('REQUIREMENTS');
  });

  it('งานที่ DONE/ABORTED ไม่นับเป็นงานค้าง', async () => {
    await seed('จบแล้ว', d(24, 9), (s) => void (s.phase = 'DONE'));
    await seed('ยกเลิก', d(24, 10), (s) => void (s.phase = 'ABORTED'));
    const io = new ScriptedIO([]);
    const job = await selectJob(repoFor(1000), io, { resume: false });
    expect(io.asked).toHaveLength(0);
    expect((await job.store.load())?.phase).toBe('REQUIREMENTS');
  });

  it('ย้าย state แบบเก่าก่อนแสดงเมนู', async () => {
    const root = path.join(projectDir, '.agent-team');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, 'state.json'), JSON.stringify(buildState()), 'utf8');
    const io = new ScriptedIO(['r1']);

    const job = await selectJob(repoFor(1000), io, { resume: false });

    expect((await job.store.load())?.phase).toBe('BUILD');
    expect(io.said.join('\n')).toContain('1) "todo list"');
  });

  describe('--resume', () => {
    it('ไม่มีงานค้าง -> error', async () => {
      await expect(selectJob(repoFor(1000), new ScriptedIO([]), { resume: true })).rejects.toThrow(
        'ไม่พบงานค้างให้ resume',
      );
    });

    it('เลือกงานค้างที่รันล่าสุด, lock และบอกชื่องาน', async () => {
      await seed('เก่า', d(24, 9));
      const newer = await seed('ใหม่', d(25, 9));
      const repo = repoFor(1000);
      const io = new ScriptedIO([]);

      const job = await selectJob(repo, io, { resume: true });

      expect(job.id).toBe(newer);
      expect(io.said).toContain(`ทำต่องาน "ใหม่" (${newer})`);
      expect(lockHolder(repo, newer)).toBe(1000);
    });

    it('ข้ามงานที่ process อื่นถือ lock อยู่', async () => {
      const older = await seed('เก่า', d(24, 9));
      const newer = await seed('ใหม่', d(25, 9));
      alive.add(2000);
      await repoFor(2000).lock(newer);
      const io = new ScriptedIO([]);

      const job = await selectJob(repoFor(1000), io, { resume: true });

      expect(job.id).toBe(older);
      expect(io.said).toContain(`ทำต่องาน "เก่า" (${older})`);
    });

    it('ทุกงานถูก lock -> error', async () => {
      const only = await seed('งาน', d(24, 9));
      alive.add(2000);
      await repoFor(2000).lock(only);
      await expect(selectJob(repoFor(1000), new ScriptedIO([]), { resume: true })).rejects.toThrow(
        'งานค้างทั้งหมดกำลังรันอยู่ใน process อื่น',
      );
    });
  });

  describe('เมนู', () => {
    it('เรียงใหม่ไปเก่า แล้ว r2 ทำต่องานที่ 2', async () => {
      const older = await seed('เก่า', d(24, 9));
      await seed('ใหม่', d(25, 9));
      const repo = repoFor(1000);
      const io = new ScriptedIO(['r2']);

      const job = await selectJob(repo, io, { resume: false });

      expect(job.id).toBe(older);
      const menu = io.said.join('\n');
      expect(menu).toContain('[PM] มีงานค้าง 2 งาน:');
      expect(menu.indexOf('1) "ใหม่"')).toBeGreaterThanOrEqual(0);
      expect(menu.indexOf('2) "เก่า"')).toBeGreaterThan(menu.indexOf('1) "ใหม่"'));
      expect(menu).toContain('เลือก: r<เลข> = ทำต่องานนั้น   d<เลข> = ลบงานนั้น   n = เริ่มงานใหม่');
      expect(lockHolder(repo, older)).toBe(1000);
    });

    it('n: สร้างงานใหม่ และงานค้างเดิมยังอยู่', async () => {
      const a = await seed('เก่า', d(24, 9));
      const b = await seed('ใหม่', d(25, 9));
      const repo = repoFor(1000);

      const job = await selectJob(repo, new ScriptedIO(['new']), { resume: false });

      expect([a, b]).not.toContain(job.id);
      expect((await repo.list()).map((j) => j.id).sort()).toEqual([a, b, job.id].sort());
    });

    it('พิมพ์ผิดแล้วถามซ้ำ และไม่สนตัวพิมพ์ใหญ่', async () => {
      const b = await seed('ใหม่', d(25, 9));
      const io = new ScriptedIO(['x', 'r9', 'R1']);

      const job = await selectJob(repoFor(1000), io, { resume: false });

      expect(job.id).toBe(b);
      expect(io.said.filter((t) => t.startsWith('เลือกไม่ถูกต้อง'))).toHaveLength(2);
    });

    it('d1 + y: ลบงานแล้วแสดงเมนูใหม่', async () => {
      const a = await seed('เก่า', d(24, 9));
      const b = await seed('ใหม่', d(25, 9));
      const repo = repoFor(1000);
      const io = new ScriptedIO(['d1', 'y', 'r1']);

      const job = await selectJob(repo, io, { resume: false });

      expect(job.id).toBe(a);
      expect(existsSync(repo.jobDir(b))).toBe(false);
      expect(io.asked[1]).toBe('ลบงาน "ใหม่" ถาวรใช่ไหม? (y/n)\n> ');
      expect(io.said).toContain('ลบงาน "ใหม่" แล้ว');
    });

    it('d1 + no: ไม่ลบ', async () => {
      await seed('เก่า', d(24, 9));
      const b = await seed('ใหม่', d(25, 9));
      const repo = repoFor(1000);

      const job = await selectJob(repo, new ScriptedIO(['d1', 'no', 'r1']), { resume: false });

      expect(job.id).toBe(b);
      expect(existsSync(repo.jobDir(b))).toBe(true);
    });

    it('ตอบยืนยันผิดรูปแบบแล้วถามซ้ำ', async () => {
      const a = await seed('เก่า', d(24, 9));
      await seed('ใหม่', d(25, 9));
      const io = new ScriptedIO(['d1', 'maybe', 'yes', 'r1']);

      const job = await selectJob(repoFor(1000), io, { resume: false });

      expect(job.id).toBe(a);
      expect(io.said).toContain('กรุณาตอบ y หรือ n');
    });

    it('ลบจนไม่เหลืองานค้าง: เริ่มงานใหม่ทันที', async () => {
      const a = await seed('งานเดียว', d(24, 9));
      const repo = repoFor(1000);
      const io = new ScriptedIO(['d1', 'y']);

      const job = await selectJob(repo, io, { resume: false });

      expect(job.id).not.toBe(a);
      expect(io.asked).toHaveLength(2);
      expect((await repo.list()).map((j) => j.id)).toEqual([job.id]);
    });

    it('r/d งานที่ process อื่นถือ lock ถูกปฏิเสธพร้อมบอก path ของ lock', async () => {
      const a = await seed('เก่า', d(24, 9));
      const b = await seed('ใหม่', d(25, 9));
      alive.add(2000);
      await repoFor(2000).lock(b);
      const repo = repoFor(1000);
      const io = new ScriptedIO(['r1', 'd1', 'r2']);

      const job = await selectJob(repo, io, { resume: false });

      expect(job.id).toBe(a);
      expect(existsSync(repo.jobDir(b))).toBe(true);
      const said = io.said.join('\n');
      expect(said).toContain('(กำลังรันอยู่ pid 2000 ตั้งแต่');
      expect(said).toContain(`ให้ลบไฟล์ ${repo.lockPath(b)} แล้วเลือกใหม่`);
      expect(io.asked).toHaveLength(3);
    });

    it('งานถูก lock หลังแสดงเมนูแล้ว: d + y ถูกปฏิเสธและโฟลเดอร์ยังอยู่', async () => {
      const a = await seed('เก่า', d(24, 9));
      const b = await seed('ใหม่', d(25, 9));
      alive.add(2000);
      const repo = repoFor(1000);
      const io = new HookIO(['d1', 'y', 'r2'], async (index) => {
        if (index === 1) await repoFor(2000).lock(b); // อีก process เลือกงานนี้ระหว่างรอยืนยัน
      });

      const job = await selectJob(repo, io, { resume: false });

      expect(job.id).toBe(a);
      expect(existsSync(repo.jobDir(b))).toBe(true);
      expect(io.said.join('\n')).toContain('กำลังรันอยู่ใน process อื่น');
    });

    it('งานเปล่าไม่ขึ้นในเมนูและถูกลบ', async () => {
      const real = await seed('งานจริง', d(24, 9));
      clock = d(25, 9);
      const setup = repoFor(9999);
      const empty = (await setup.create()).id;
      await setup.unlock(empty);
      const repo = repoFor(1000);
      const io = new ScriptedIO(['r1']);

      const job = await selectJob(repo, io, { resume: false });

      expect(job.id).toBe(real);
      expect(existsSync(repo.jobDir(empty))).toBe(false);
      expect(io.said.join('\n')).toContain('[PM] มีงานค้าง 1 งาน:');
    });

    it('งานเปล่าที่ลบไม่สำเร็จ: selectJob ไม่ throw และแสดงเมนูต่อได้ปกติ', async () => {
      const real = await seed('งานจริง', d(24, 9));
      clock = d(25, 9);
      const setup = repoFor(9999);
      const empty = (await setup.create()).id;
      await setup.unlock(empty);

      class FailingRemoveRepo extends JobRepository {
        override async remove(id: string): Promise<void> {
          if (id === empty) throw new Error('remove ล้มเหลว');
          return super.remove(id);
        }
      }
      const repo = new FailingRemoveRepo(projectDir, { now: () => clock, pid: 1000, isAlive: (p) => alive.has(p) });
      const io = new ScriptedIO(['r1']);

      const job = await selectJob(repo, io, { resume: false });

      expect(job.id).toBe(real);
      // ลบไม่สำเร็จ (best-effort) แต่ selectJob ยังทำงานต่อได้ปกติ ไม่ throw
      expect(existsSync(repo.jobDir(empty))).toBe(true);
    });

    it('งานเปล่าที่ process อื่นถือ lock อยู่ไม่ถูกลบและไม่ขึ้นในเมนู', async () => {
      const real = await seed('งานจริง', d(24, 9));
      alive.add(2000);
      clock = d(25, 9);
      const busy = (await repoFor(2000).create()).id;
      const repo = repoFor(1000);
      const io = new ScriptedIO(['r1']);

      const job = await selectJob(repo, io, { resume: false });

      expect(job.id).toBe(real);
      expect(existsSync(repo.jobDir(busy))).toBe(true);
      expect(io.said.join('\n')).toContain('[PM] มีงานค้าง 1 งาน:');
    });

    it('เตือนเมื่องานอื่นแก้โค้ดหลังจากงานนี้', async () => {
      await seed('เก่า', d(24, 9));
      await seed('หน้า report', d(25, 9), (s) => {
        Object.assign(s, buildState(), { title: 'หน้า report' });
        s.progress.api!.rounds = 1;
      });
      const io = new ScriptedIO(['r1']);

      await selectJob(repoFor(1000), io, { resume: false });

      const menu = io.said.join('\n');
      expect(menu).toContain('     ⚠ งาน "todo list" แก้โค้ดหลังจากงานนี้ โค้ดอาจเปลี่ยนไปแล้ว');
      expect(menu.match(/⚠/g)).toHaveLength(1);
    });

    it('งานอื่นแค่คุยกับ PM ไม่ทำให้ขึ้นคำเตือน', async () => {
      await seed('เก่า', d(24, 9));
      await seed('คุยอย่างเดียว', d(25, 9), (s) => void (s.pmSessionId = 'pm'));
      const io = new ScriptedIO(['r1']);

      await selectJob(repoFor(1000), io, { resume: false });

      expect(io.said.join('\n')).not.toContain('⚠');
    });
  });
});
