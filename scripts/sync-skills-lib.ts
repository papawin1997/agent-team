import * as fs from 'node:fs';
import * as path from 'node:path';

/** skills/sync.json */
export interface SyncConfig {
  repo: string;
  deny: string[];
}

export interface SyncOptions {
  sourceDir: string;
  /** skills/skills ของ plugin team */
  targetDir: string;
  /** skills/synced.json: ชื่อ skill ที่ sync มาครั้งก่อน (ใช้ตัดสินว่าลบ/ทับได้ไหม) */
  manifestFile: string;
  /** ปลายทางของ licenses/ จากต้นทาง */
  licensesDir: string;
  deny: readonly string[];
}

export interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  /** ชื่อซ้ำกับ skill ที่เขียนเองใน plugin จึงไม่ทับ */
  skipped: string[];
}

const hasSkill = (dir: string): boolean => fs.existsSync(path.join(dir, 'SKILL.md'));

/** ชื่อ skill ในต้นทาง: โฟลเดอร์ที่มี SKILL.md ไม่ขึ้นต้นด้วยจุด และไม่อยู่ใน deny */
export function listSourceSkills(sourceDir: string, deny: readonly string[]): string[] {
  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !deny.includes(e.name))
    .map((e) => e.name)
    .filter((name) => hasSkill(path.join(sourceDir, name)))
    .sort();
}

function readManifest(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function syncSkills(opts: SyncOptions): SyncResult {
  const previous = readManifest(opts.manifestFile);
  const result: SyncResult = { added: [], updated: [], removed: [], skipped: [] };
  const synced: string[] = [];
  fs.mkdirSync(opts.targetDir, { recursive: true });

  for (const name of listSourceSkills(opts.sourceDir, opts.deny)) {
    const target = path.join(opts.targetDir, name);
    const exists = fs.existsSync(target);
    // มีอยู่แล้วแต่ไม่ได้มาจากการ sync = skill ที่ผู้ใช้เขียนเอง ห้ามทับ
    if (exists && !previous.includes(name)) {
      result.skipped.push(name);
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(path.join(opts.sourceDir, name), target, { recursive: true, dereference: true });
    (exists ? result.updated : result.added).push(name);
    synced.push(name);
  }

  // ลบเฉพาะตัวที่เคย sync มาแต่รอบนี้ไม่มีแล้ว (หายจากต้นทางหรือถูกเพิ่มเข้า deny)
  for (const name of previous) {
    if (synced.includes(name)) continue;
    fs.rmSync(path.join(opts.targetDir, name), { recursive: true, force: true });
    result.removed.push(name);
  }

  const licenses = path.join(opts.sourceDir, 'licenses');
  if (fs.existsSync(licenses)) {
    fs.rmSync(opts.licensesDir, { recursive: true, force: true });
    fs.cpSync(licenses, opts.licensesDir, { recursive: true, dereference: true });
  }

  fs.writeFileSync(opts.manifestFile, `${JSON.stringify(synced, null, 2)}\n`);
  return result;
}

/** โฟลเดอร์ต้นทางในเครื่อง: --from → SKILL_AI_NAJA_DIR → ~/ai-skills ; null = ต้อง clone */
export function resolveSource(input: { from?: string; env: NodeJS.ProcessEnv; home: string }): string | null {
  const explicit = input.from ?? input.env.SKILL_AI_NAJA_DIR;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`ไม่พบโฟลเดอร์ต้นทาง: ${explicit}`);
    return path.resolve(explicit);
  }
  const local = path.join(input.home, 'ai-skills');
  return fs.existsSync(local) ? local : null;
}

export function formatResult(r: SyncResult): string {
  const line = (label: string, names: string[]) =>
    `${label} (${names.length}): ${names.length > 0 ? names.join(', ') : '-'}`;
  return [
    line('เพิ่ม', r.added),
    line('อัปเดต', r.updated),
    line('ลบ', r.removed),
    line('ข้าม (ชื่อซ้ำกับ skill ที่เขียนเอง)', r.skipped),
    'ตรวจ diff ใน skills/ แล้ว commit เอง',
  ].join('\n');
}
