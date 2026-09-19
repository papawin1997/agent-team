import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FileStateStore, newState } from '../src/state';

let projectDir: string;

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-'));
});

describe('FileStateStore', () => {
  it('load คืน undefined เมื่อยังไม่มี state', async () => {
    expect(await new FileStateStore(projectDir).load()).toBeUndefined();
  });

  it('save แล้ว load ได้ข้อมูลเดิม', async () => {
    const store = new FileStateStore(projectDir);
    const state = newState();
    state.phase = 'BUILD';
    state.pmSessionId = 'abc';
    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  it('save เขียนที่ .agent-team/state.json', async () => {
    await new FileStateStore(projectDir).save(newState());
    const raw = await fs.readFile(path.join(projectDir, '.agent-team', 'state.json'), 'utf8');
    expect(JSON.parse(raw).version).toBe(1);
  });

  it('saveArtifact สร้างโฟลเดอร์ย่อยให้อัตโนมัติ', async () => {
    await new FileStateStore(projectDir).saveArtifact('reports/api-round1.json', { ok: true });
    const raw = await fs.readFile(
      path.join(projectDir, '.agent-team', 'reports', 'api-round1.json'),
      'utf8',
    );
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  it('load ปฏิเสธ state ที่ version ไม่ตรง', async () => {
    const dir = path.join(projectDir, '.agent-team');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ version: 99 }), 'utf8');
    await expect(new FileStateStore(projectDir).load()).rejects.toThrow('version');
  });
});
