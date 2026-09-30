import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureTeamDir } from '../src/team-dir';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-dir-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('ensureTeamDir', () => {
  it('สร้าง .agent-team พร้อม .gitignore ที่ ignore ทั้งโฟลเดอร์', () => {
    const project = tmp();
    const dir = ensureTeamDir(project);
    expect(dir).toBe(path.join(project, '.agent-team'));
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('เพิ่ม .gitignore ให้ .agent-team ที่มีอยู่แล้ว (โปรเจกต์เก่า)', () => {
    const project = tmp();
    fs.mkdirSync(path.join(project, '.agent-team'));
    fs.writeFileSync(path.join(project, '.agent-team', 'agent-team.log'), 'x');
    ensureTeamDir(project);
    expect(fs.readFileSync(path.join(project, '.agent-team', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('ไม่เขียนทับ .gitignore ที่ผู้ใช้แก้ไว้', () => {
    const project = tmp();
    fs.mkdirSync(path.join(project, '.agent-team'));
    fs.writeFileSync(path.join(project, '.agent-team', '.gitignore'), '*.log\n');
    ensureTeamDir(project);
    expect(fs.readFileSync(path.join(project, '.agent-team', '.gitignore'), 'utf8')).toBe('*.log\n');
  });
});
