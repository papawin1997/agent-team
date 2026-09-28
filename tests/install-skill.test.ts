import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installSkill, SKILL_SOURCE } from '../src/install-skill';

describe('installSkill', () => {
  it('copy SKILL.md ไปที่ ~/.claude/skills/agent-team/ (สร้างโฟลเดอร์ให้) และเขียนทับของเก่า', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-home-'));
    const source = path.join(home, 'src-SKILL.md');
    fs.writeFileSync(source, 'v1', 'utf8');
    const target = installSkill({ home, source });
    expect(target).toBe(path.join(home, '.claude', 'skills', 'agent-team', 'SKILL.md'));
    expect(fs.readFileSync(target, 'utf8')).toBe('v1');
    fs.writeFileSync(source, 'v2', 'utf8');
    installSkill({ home, source });
    expect(fs.readFileSync(target, 'utf8')).toBe('v2');
  });
});

describe('SKILL_SOURCE', () => {
  it('มีไฟล์จริง frontmatter ชื่อ agent-team และอ้างทุกคำสั่ง/สถานะที่ CLI มี', () => {
    const text = fs.readFileSync(SKILL_SOURCE, 'utf8');
    expect(text).toMatch(/^---\r?\nname: agent-team\r?\n/);
    for (const word of ['--headless', 'wait', 'answer', 'stop', '--since', '--job', 'timeout: 600000']) {
      expect(text).toContain(word);
    }
    for (const status of ['question', 'running', 'done', 'aborted', 'error', 'stopped', 'idle', 'dead']) {
      expect(text).toContain(`\`${status}\``);
    }
  });

  it('ไม่ได้อยู่ใต้ skills/ (plugin ของ role agent)', () => {
    expect(SKILL_SOURCE.split(path.sep)).not.toContain('skills');
  });
});
