import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatResult, listSourceSkills, resolveSource, syncSkills } from '../scripts/sync-skills-lib';

let root: string;
let source: string;
let target: string;
let manifestFile: string;
let licensesDir: string;

const write = (file: string, content = 'x') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const skill = (dir: string, name: string, body = `# ${name}`) => write(path.join(dir, name, 'SKILL.md'), body);
const run = (deny: string[] = []) => syncSkills({ sourceDir: source, targetDir: target, manifestFile, licensesDir, deny });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-skills-'));
  source = path.join(root, 'src');
  target = path.join(root, 'plugin', 'skills');
  manifestFile = path.join(root, 'plugin', 'synced.json');
  licensesDir = path.join(root, 'plugin', 'licenses');
  fs.mkdirSync(source, { recursive: true });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('listSourceSkills', () => {
  it('เอาเฉพาะโฟลเดอร์ที่มี SKILL.md ไม่อยู่ใน deny และไม่ขึ้นต้นด้วยจุด เรียงตามชื่อ', () => {
    skill(source, 'b-skill');
    skill(source, 'a-skill');
    skill(source, 'denied');
    skill(source, '.hidden');
    write(path.join(source, 'licenses', 'MIT.txt'));
    write(path.join(source, 'README.md'));
    expect(listSourceSkills(source, ['denied'])).toEqual(['a-skill', 'b-skill']);
  });
});

describe('syncSkills', () => {
  it('copy ทั้งโฟลเดอร์ (รวมไฟล์ประกอบ) และจดชื่อลง manifest', () => {
    skill(source, 'tb-scrutinize');
    write(path.join(source, 'tb-scrutinize', 'scripts', 'helper.js'), 'h');
    const r = run();
    expect(r.added).toEqual(['tb-scrutinize']);
    expect(fs.readFileSync(path.join(target, 'tb-scrutinize', 'scripts', 'helper.js'), 'utf8')).toBe('h');
    expect(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))).toEqual(['tb-scrutinize']);
  });

  it('ข้าม skill ใน deny', () => {
    skill(source, 'web-pow');
    skill(source, 'tb-scrutinize');
    run(['web-pow']);
    expect(fs.existsSync(path.join(target, 'web-pow'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'tb-scrutinize', 'SKILL.md'))).toBe(true);
  });

  it('sync ซ้ำ: ทับทั้งโฟลเดอร์ ไฟล์ที่หายจากต้นทางก็หายจากปลายทาง และนับเป็น updated', () => {
    skill(source, 'tb-scrutinize');
    write(path.join(source, 'tb-scrutinize', 'old.md'));
    run();
    fs.rmSync(path.join(source, 'tb-scrutinize', 'old.md'));
    skill(source, 'tb-scrutinize', 'v2');
    const r = run();
    expect(r.updated).toEqual(['tb-scrutinize']);
    expect(fs.existsSync(path.join(target, 'tb-scrutinize', 'old.md'))).toBe(false);
    expect(fs.readFileSync(path.join(target, 'tb-scrutinize', 'SKILL.md'), 'utf8')).toBe('v2');
  });

  it('ลบเฉพาะ skill ที่เคย sync มาแล้วหายจากต้นทางหรือถูก deny', () => {
    skill(source, 'gone');
    skill(source, 'to-deny');
    skill(source, 'stay');
    run();
    fs.rmSync(path.join(source, 'gone'), { recursive: true });
    const r = run(['to-deny']);
    expect(r.removed.sort()).toEqual(['gone', 'to-deny']);
    expect(fs.existsSync(path.join(target, 'gone'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'to-deny'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))).toEqual(['stay']);
  });

  it('ไม่แตะ skill ที่เขียนเองใน plugin และไม่ทับเมื่อชื่อซ้ำ (รายงาน skipped)', () => {
    skill(target, 'my-own', 'mine');
    skill(target, 'clash', 'mine');
    skill(source, 'clash', 'theirs');
    const r = run();
    expect(r.skipped).toEqual(['clash']);
    expect(fs.readFileSync(path.join(target, 'clash', 'SKILL.md'), 'utf8')).toBe('mine');
    expect(fs.readFileSync(path.join(target, 'my-own', 'SKILL.md'), 'utf8')).toBe('mine');
    expect(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))).toEqual([]);
  });

  it('copy licenses/ ของต้นทางไปที่ licensesDir', () => {
    skill(source, 'a');
    write(path.join(source, 'licenses', 'superpowers-MIT.txt'), 'MIT');
    run();
    expect(fs.readFileSync(path.join(licensesDir, 'superpowers-MIT.txt'), 'utf8')).toBe('MIT');
  });
});

describe('resolveSource', () => {
  it('--from มาก่อน env และ ~/ai-skills', () => {
    const from = path.join(root, 'from');
    fs.mkdirSync(from);
    expect(resolveSource({ from, env: { SKILL_AI_NAJA_DIR: source }, home: root })).toBe(from);
  });

  it('ใช้ SKILL_AI_NAJA_DIR เมื่อไม่มี --from', () => {
    expect(resolveSource({ env: { SKILL_AI_NAJA_DIR: source }, home: root })).toBe(source);
  });

  it('ใช้ ~/ai-skills เมื่อไม่ระบุอะไร', () => {
    const local = path.join(root, 'ai-skills');
    fs.mkdirSync(local);
    expect(resolveSource({ env: {}, home: root })).toBe(local);
  });

  it('คืน null เมื่อไม่มีต้นทางในเครื่อง (ต้อง clone)', () => {
    expect(resolveSource({ env: {}, home: root })).toBeNull();
  });

  it('path ที่ระบุแต่ไม่มีอยู่ -> error ที่บอก path', () => {
    const missing = path.join(root, 'nope');
    expect(() => resolveSource({ from: missing, env: {}, home: root })).toThrow(missing);
  });
});

describe('formatResult', () => {
  it('สรุปทุกหมวดและเตือนให้ commit เอง', () => {
    const text = formatResult({ added: ['a'], updated: [], removed: ['b'], skipped: [] });
    expect(text).toContain('เพิ่ม (1): a');
    expect(text).toContain('อัปเดต (0): -');
    expect(text).toContain('ลบ (1): b');
    expect(text).toContain('commit เอง');
  });
});

describe('skills/sync.json', () => {
  it('ชี้ repo skill-ai-naja และ deny ครบ 8 ตัวตาม design', () => {
    const cfg = JSON.parse(fs.readFileSync(path.resolve('skills', 'sync.json'), 'utf8'));
    expect(cfg.repo).toBe('https://github.com/papawin1997/skill-ai-naja.git');
    expect([...cfg.deny].sort()).toEqual(
      [
        'handoff',
        'tb-executing-plans',
        'tb-finishing-a-development-branch',
        'tb-read-jira',
        'tb-requesting-code-review',
        'tb-subagent-driven-development',
        'tb-using-git-worktrees',
        'web-pow',
      ].sort(),
    );
  });
});
