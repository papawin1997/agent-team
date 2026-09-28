import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TEAM_ROOT } from './config';

/** skill สำหรับ Claude Code ของผู้ใช้ (แยกจาก skills/ ซึ่งเป็น plugin team ของ role agent) */
export const SKILL_SOURCE = path.join(TEAM_ROOT, 'claude-skill', 'agent-team', 'SKILL.md');

/** copy SKILL.md ไปที่ ~/.claude/skills/agent-team/SKILL.md (เขียนทับ) แล้วคืนพาธปลายทาง */
export function installSkill(opts: { home?: string; source?: string } = {}): string {
  const source = opts.source ?? SKILL_SOURCE;
  const target = path.join(opts.home ?? os.homedir(), '.claude', 'skills', 'agent-team', 'SKILL.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return target;
}
