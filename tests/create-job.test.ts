import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJobWithPrompt } from '../src/job-menu';
import { JobRepository } from '../src/jobs';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

describe('createJobWithPrompt', () => {
  it('สร้างงานใหม่ที่ lock แล้ว มี pendingPrompt และ title (ตัดที่ 60 ตัวอักษร)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-team-createjob-'));
    dirs.push(dir);
    const repo = new JobRepository(dir);
    const job = await createJobWithPrompt(repo, 'คำขอจาก ask', 'ก'.repeat(70));
    const state = await job.store.load();
    expect(state?.pendingPrompt).toBe('คำขอจาก ask');
    expect(state?.title).toBe('ก'.repeat(60));
    const info = (await repo.list()).find((j) => j.id === job.id);
    expect(info?.lock).toBeDefined();
    await repo.unlock(job.id);
  });

  it('ไม่ส่ง title -> ไม่ตั้ง title (ให้ REQUIREMENTS ตั้งจากข้อความแรกเหมือนเดิม)', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agent-team-createjob-'));
    dirs.push(dir);
    const repo = new JobRepository(dir);
    const job = await createJobWithPrompt(repo, 'x');
    expect((await job.store.load())?.title).toBeUndefined();
    await repo.unlock(job.id);
  });
});
