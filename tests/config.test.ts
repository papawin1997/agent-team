import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, mergeConfig, ROLE_NAMES } from '../src/config';

describe('DEFAULT_CONFIG', () => {
  it('limit QA = 5 รอบ และ continue เพิ่ม 5 รอบ', () => {
    expect(DEFAULT_CONFIG.maxQaRounds).toBe(5);
    expect(DEFAULT_CONFIG.extraRoundsOnContinue).toBe(5);
  });

  it('มีครบทุก role และทุก role ไม่เปิด skill', () => {
    for (const role of ROLE_NAMES) {
      expect(DEFAULT_CONFIG.roles[role].skills).toEqual([]);
    }
  });

  it('pm กับ planning ใช้เครื่องมืออ่านอย่างเดียว', () => {
    for (const role of ['pm', 'planning'] as const) {
      expect(DEFAULT_CONFIG.roles[role].tools).toEqual(['Read', 'Glob', 'Grep']);
    }
  });

  it('worker และ qa มี Edit/Write/Bash', () => {
    for (const role of ['frontend', 'backend', 'qa'] as const) {
      expect(DEFAULT_CONFIG.roles[role].tools).toEqual(
        expect.arrayContaining(['Edit', 'Write', 'Bash']),
      );
    }
  });

  it('worker และ qa รัน go toolchain ได้ (build/vet/test/run/mod) แต่ไม่ได้ pre-approve docker', () => {
    for (const role of ['frontend', 'backend', 'qa'] as const) {
      const allowed = DEFAULT_CONFIG.roles[role].allowedTools;
      expect(allowed).toContain('Bash(go *)');
      expect(allowed.some((entry) => entry.startsWith('Bash(docker'))).toBe(false);
    }
  });

  it('worker และ qa อนุญาต git แบบอ่านอย่างเดียว', () => {
    for (const role of ['frontend', 'backend', 'qa'] as const) {
      expect(DEFAULT_CONFIG.roles[role].allowedTools).toEqual(
        expect.arrayContaining([
          'Bash(git status)',
          'Bash(git status *)',
          'Bash(git diff)',
          'Bash(git diff *)',
          'Bash(git log *)',
          'Bash(git show *)',
          'Bash(git ls-files *)',
          'Bash(git rev-parse *)',
          'Bash(git blame *)',
        ]),
      );
    }
  });

  it('allowedTools ไม่มี git ที่เขียนได้ (push/commit/reset ฯลฯ) และไม่มี Bash(git *)', () => {
    const readOnly = ['status', 'diff', 'log', 'show', 'ls-files', 'rev-parse', 'blame'];
    for (const role of ROLE_NAMES) {
      for (const entry of DEFAULT_CONFIG.roles[role].allowedTools) {
        const m = /^Bash\(git ([^ )]*)/.exec(entry);
        if (entry.startsWith('Bash(git')) {
          expect(m, entry).not.toBeNull();
          expect(readOnly, entry).toContain(m![1]);
        }
      }
    }
    expect(DEFAULT_CONFIG.roles.backend.allowedTools).not.toContain('Bash(git *)');
  });

  it('pm กับ planning ไม่มี Bash ใน allowedTools', () => {
    for (const role of ['pm', 'planning'] as const) {
      expect(DEFAULT_CONFIG.roles[role].allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    }
  });

  it('planning ใช้ claude-opus-5 ส่วน role อื่นใช้ claude-sonnet-5', () => {
    expect(DEFAULT_CONFIG.roles.planning.model).toBe('claude-opus-5');
    expect(DEFAULT_CONFIG.roles.qa.model).toBe('claude-sonnet-5');
  });
});

describe('mergeConfig', () => {
  it('override skills ของ frontend โดยไม่กระทบ role อื่น', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      roles: { frontend: { skills: ['team:frontend-conventions'] } },
    });
    expect(merged.roles.frontend.skills).toEqual(['team:frontend-conventions']);
    expect(merged.roles.frontend.model).toBe('claude-sonnet-5');
    expect(merged.roles.backend.skills).toEqual([]);
  });

  it('override maxQaRounds ได้', () => {
    expect(mergeConfig(DEFAULT_CONFIG, { maxQaRounds: 3 }).maxQaRounds).toBe(3);
  });

  it('ปฏิเสธ key ที่ไม่รู้จัก', () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, { nope: 1 })).toThrow();
    expect(() => mergeConfig(DEFAULT_CONFIG, { roles: { pm: { tools: ['Bash'] } } })).toThrow();
  });
});

describe('loadConfig', () => {
  it('คืนค่า default เมื่อไม่มีไฟล์', () => {
    expect(loadConfig(path.join(os.tmpdir(), 'no-such-agent-team-config.json'))).toBe(DEFAULT_CONFIG);
  });

  it('อ่านและ merge ไฟล์ config', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-cfg-')), 'c.json');
    fs.writeFileSync(file, JSON.stringify({ roles: { qa: { maxTurns: 10 } } }));
    expect(loadConfig(file).roles.qa.maxTurns).toBe(10);
  });
});
