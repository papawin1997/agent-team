import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { TEAM_ROOT } from './config';

export interface ProjectEntry {
  path: string;
  /** ISO time ที่เปิดใช้ล่าสุด */
  lastUsedAt: string;
}

export interface ProjectRegistryOptions {
  now?: () => Date;
  warn?: (message: string) => void;
}

const RegistryFileSchema = z.object({
  version: z.literal(1),
  projects: z.array(z.object({ path: z.string().min(1), lastUsedAt: z.string().min(1) })),
});

export const defaultRegistryFile = (): string => path.join(os.homedir(), '.agent-team', 'projects.json');

/** Windows ไม่สนตัวพิมพ์ใหญ่เล็กของ path */
const normalize = (p: string): string => {
  const abs = path.resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
};

export const samePath = (a: string, b: string): boolean => normalize(a) === normalize(b);

/** ห้ามให้ทีม agent ทำงานใน repo agent-team เอง (จะโหลด .claude/settings.json และแก้โค้ดของทีมได้) */
export function teamRootError(dir: string, teamRoot: string = TEAM_ROOT): string | undefined {
  const rel = path.relative(normalize(teamRoot), normalize(dir));
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  return inside
    ? `ห้ามใช้ repo agent-team (${teamRoot}) เป็นโปรเจกต์ — เลือกโฟลเดอร์ของแอปที่จะให้ทีมทำงาน`
    : undefined;
}

/** รายชื่อโปรเจกต์ที่เคยใช้บนเครื่องนี้ (~/.agent-team/projects.json) */
export class ProjectRegistry {
  readonly file: string;
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;

  constructor(file: string = defaultRegistryFile(), opts: ProjectRegistryOptions = {}) {
    this.file = file;
    this.now = opts.now ?? (() => new Date());
    this.warn = opts.warn ?? (() => {});
  }

  /** เรียงที่ใช้ล่าสุดก่อน */
  async list(): Promise<ProjectEntry[]> {
    const projects = await this.load();
    return projects.sort((a, b) => Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt));
  }

  /** เพิ่มโปรเจกต์ หรืออัปเดตเวลาใช้ล่าสุดถ้ามีอยู่แล้ว */
  async touch(dir: string): Promise<void> {
    const abs = path.resolve(dir);
    const rest = (await this.load()).filter((p) => !samePath(p.path, abs));
    await this.save([...rest, { path: abs, lastUsedAt: this.now().toISOString() }]);
  }

  /** เอาออกจากรายชื่อเท่านั้น ไม่ลบไฟล์ของโปรเจกต์ */
  async remove(dir: string): Promise<void> {
    const projects = await this.load();
    const rest = projects.filter((p) => !samePath(p.path, dir));
    if (rest.length !== projects.length) await this.save(rest);
  }

  private async load(): Promise<ProjectEntry[]> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = undefined;
    }
    const parsed = RegistryFileSchema.safeParse(data);
    if (parsed.success) return parsed.data.projects;
    const backup = `${this.file}.bak`;
    await fsp.rename(this.file, backup);
    this.warn(`รายชื่อโปรเจกต์ ${this.file} อ่านไม่ได้ — ย้ายไปไว้ที่ ${backup} แล้วเริ่มรายชื่อใหม่`);
    return [];
  }

  private async save(projects: ProjectEntry[]): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, this.file);
  }
}
