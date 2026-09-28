import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runHeadlessCommand } from '../../src/headless/commands';
import { headlessPath, readJsonSafe, writeJsonAtomic, type Answer, type ExitInfo } from '../../src/headless/files';
import { JobRepository } from '../../src/jobs';

let projectDir: string;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-cmd-'));
});

/** งาน headless ที่ lock ด้วย pid ของ process จริงที่ยังอยู่ (process.pid ของเทสต์เอง) */
async function runningJob(): Promise<{ id: string; dir: string; repo: JobRepository }> {
  const repo = new JobRepository(projectDir);
  const { id } = await repo.create();
  const dir = repo.jobDir(id);
  fs.appendFileSync(headlessPath(dir, 'events'), '');
  return { id, dir, repo };
}

const ask = (dir: string, kind: 'text' | 'choice' | 'choiceOrText', options?: string[]) =>
  writeJsonAtomic(headlessPath(dir, 'question'), { id: 'q1', kind, prompt: '?', askedAt: 't', ...(options ? { options } : {}) });

describe('answer', () => {
  it('เขียน answer.json ด้วย questionId ปัจจุบัน', async () => {
    const { id, dir } = await runningJob();
    ask(dir, 'choiceOrText', ['confirm', 'revise']);
    const result = await runHeadlessCommand({ command: 'answer', projectDir, job: id, text: 'ทำไมต้องมี login?' });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout!)).toMatchObject({ ok: true, jobId: id, questionId: 'q1' });
    expect(readJsonSafe<Answer>(headlessPath(dir, 'answer'))).toEqual({ questionId: 'q1', text: 'ทำไมต้องมี login?' });
  });

  it('kind choice: รับเลขลำดับ/ชื่อ option แต่ปฏิเสธข้อความอื่นพร้อมบอกตัวเลือก', async () => {
    const { id, dir } = await runningJob();
    ask(dir, 'choice', ['a', 'b']);
    const bad = await runHeadlessCommand({ command: 'answer', projectDir, job: id, text: 'c' });
    expect(bad).toMatchObject({ exitCode: 1 });
    expect(bad.stderr).toContain('a, b');
    expect((await runHeadlessCommand({ command: 'answer', projectDir, job: id, text: '2' })).exitCode).toBe(0);
  });

  it('ไม่มีคำถาม / มีคำตอบค้าง → exit 1', async () => {
    const { id, dir } = await runningJob();
    expect((await runHeadlessCommand({ command: 'answer', projectDir, job: id, text: 'x' })).stderr).toContain('ไม่มีคำถาม');
    ask(dir, 'text');
    writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: 'q1', text: 'ก่อนหน้า' });
    expect((await runHeadlessCommand({ command: 'answer', projectDir, job: id, text: 'x' })).stderr).toContain('รอ process อ่าน');
  });

  it('answer.json ค้างที่ questionId ไม่ตรงคำถามปัจจุบัน → เขียนทับได้', async () => {
    const { id, dir } = await runningJob();
    ask(dir, 'text');
    writeJsonAtomic(headlessPath(dir, 'answer'), { questionId: 'q0', text: 'ค้าง' });
    const result = await runHeadlessCommand({ command: 'answer', projectDir, job: id, text: 'ใหม่' });
    expect(result.exitCode).toBe(0);
    expect(readJsonSafe<Answer>(headlessPath(dir, 'answer'))).toEqual({ questionId: 'q1', text: 'ใหม่' });
  });

  it('process ไม่ได้รันอยู่ → exit 1 พร้อมวิธีทำต่อ', async () => {
    const { id, dir, repo } = await runningJob();
    ask(dir, 'text');
    await repo.unlock(id);
    const result = await runHeadlessCommand({ command: 'answer', projectDir, job: id, text: 'x' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`--job ${id}`);
  });
});

describe('wait / status', () => {
  it('status คืน JSON ของ StatusReport', async () => {
    const { id } = await runningJob();
    const result = await runHeadlessCommand({ command: 'status', projectDir, job: id, timeoutSec: 0 });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout!)).toMatchObject({ jobId: id, status: 'running' });
  });

  it('wait ไม่ระบุ job: รอจนงาน headless เริ่ม (ไม่หยิบงานเก่า)', async () => {
    const pending = runHeadlessCommand({ command: 'wait', projectDir, timeoutSec: 5 }, { pollMs: 5 });
    await new Promise((r) => setTimeout(r, 30));
    const { id, dir } = await runningJob();
    ask(dir, 'text');
    const result = await pending;
    expect(JSON.parse(result.stdout!)).toMatchObject({ jobId: id, status: 'question' });
  });

  it('wait ไม่ระบุ job และไม่มีงานรันจนครบ timeout → exit 1', async () => {
    const result = await runHeadlessCommand({ command: 'wait', projectDir, timeoutSec: 0 }, { pollMs: 5 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ไม่พบงาน headless ที่กำลังรัน');
  });
});

describe('stop', () => {
  it('process หยุดเองภายใน grace → stopped true และเขียน stop.json', async () => {
    const { id, dir, repo } = await runningJob();
    const sleep = vi.fn(async () => {
      expect(fs.existsSync(headlessPath(dir, 'stop'))).toBe(true);
      await repo.unlock(id); // จำลอง process เห็น stop.json แล้วจบ
    });
    const result = await runHeadlessCommand({ command: 'stop', projectDir, job: id }, { sleep, pollMs: 10, stopGraceMs: 100 });
    expect(JSON.parse(result.stdout!)).toMatchObject({ ok: true, stopped: true });
  });

  it('ไม่ตอบสนอง → kill pid, ลบ lock และเขียน exit.json stopped', async () => {
    const { id, dir, repo } = await runningJob();
    const kill = vi.fn();
    const result = await runHeadlessCommand(
      { command: 'stop', projectDir, job: id },
      { sleep: async () => {}, kill, pollMs: 10, stopGraceMs: 30 },
    );
    expect(kill).toHaveBeenCalledWith(process.pid);
    expect(JSON.parse(result.stdout!)).toMatchObject({ stopped: true, killed: true });
    expect(fs.existsSync(repo.lockPath(id))).toBe(false);
    expect(readJsonSafe<ExitInfo>(headlessPath(dir, 'exit'))?.status).toBe('stopped');
  });

  it('งานไม่ได้รันอยู่ → exit 0 stopped false', async () => {
    const { id, repo } = await runningJob();
    await repo.unlock(id);
    const result = await runHeadlessCommand({ command: 'stop', projectDir, job: id });
    expect(JSON.parse(result.stdout!)).toMatchObject({ stopped: false });
  });

  it('งานที่ไม่ใช่ headless → exit 1', async () => {
    const repo = new JobRepository(projectDir);
    const { id } = await repo.create();
    const result = await runHeadlessCommand({ command: 'stop', projectDir, job: id });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('headless');
  });
});

describe('install-skill', () => {
  it('รายงานพาธที่ติดตั้ง', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-home-'));
    const source = path.join(home, 'SKILL.md');
    fs.writeFileSync(source, 'x', 'utf8');
    const result = await runHeadlessCommand({ command: 'install-skill' }, { home, skillSource: source });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(path.join(home, '.claude', 'skills', 'agent-team', 'SKILL.md'));
  });
});
