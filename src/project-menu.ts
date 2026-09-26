import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { UserIO } from './deps';
import { localDateTime } from './format';
import { confirmYesNo } from './io-util';
import { isPending } from './job-menu';
import { JobRepository } from './jobs';
import { teamRootError, type ProjectEntry, type ProjectRegistry } from './projects';

const MENU_HELP = 'เลือก: <เลข> = เปิดโปรเจกต์   n = โปรเจกต์ใหม่   d<เลข> = เอาออกจากเมนู   q = ออก';
const ASK_PATH = 'ใส่ root path ของโปรเจกต์ (ว่าง = ยกเลิก)\n> ';

export interface ProjectMenuDeps {
  registry: ProjectRegistry;
  io: UserIO;
  /** จำนวนงานค้างของโปรเจกต์ (เทสต์ส่งค่าปลอมได้) */
  countPending?: (dir: string) => Promise<number>;
  /** repo agent-team ที่ห้ามใช้เป็นโปรเจกต์ (ค่าเริ่มต้น TEAM_ROOT) */
  teamRoot?: string;
}

export async function countPendingJobs(dir: string): Promise<number> {
  return (await new JobRepository(dir).list()).filter(isPending).length;
}

const isDir = (p: string): boolean => fs.existsSync(p) && fs.statSync(p).isDirectory();

/** เลือกโปรเจกต์ตอนรัน agent-team โดยไม่ระบุ path: คืน path เต็ม หรือ undefined เมื่อผู้ใช้ออก */
export async function selectProject(deps: ProjectMenuDeps): Promise<string | undefined> {
  const { registry, io } = deps;
  for (;;) {
    const projects = await registry.list();
    if (projects.length === 0) {
      io.say('ยังไม่มีโปรเจกต์ในรายชื่อ');
      return askNewProject(deps);
    }
    const counts = await Promise.all(projects.map((p) => safeCount(deps, p.path)));
    io.say(renderMenu(projects, counts));
    const answer = (await io.ask('> ')).trim().toLowerCase();
    if (answer === 'q' || answer === 'quit') return undefined;
    if (answer === 'n' || answer === 'new') {
      const dir = await askNewProject(deps);
      if (dir) return dir;
      continue;
    }
    const match = /^(d?)\s*(\d+)$/.exec(answer);
    const project = match ? projects[Number(match[2]) - 1] : undefined;
    if (!match || !project) {
      io.say(`เลือกไม่ถูกต้อง — ${MENU_HELP}`);
      continue;
    }
    if (match[1] === 'd') {
      await registry.remove(project.path);
      io.say(`เอา ${project.path} ออกจากเมนูแล้ว (ไฟล์ในโฟลเดอร์ยังอยู่ครบ)`);
      continue;
    }
    if (!isDir(project.path)) {
      io.say(`ไม่พบโฟลเดอร์ ${project.path} — ถ้าย้ายไปแล้วให้กด n ใส่ path ใหม่ หรือ d${match[2]} เพื่อเอาออกจากเมนู`);
      continue;
    }
    return project.path;
  }
}

async function safeCount(deps: ProjectMenuDeps, dir: string): Promise<number | undefined> {
  if (!isDir(dir)) return undefined;
  try {
    return await (deps.countPending ?? countPendingJobs)(dir);
  } catch {
    return undefined;
  }
}

function renderMenu(projects: readonly ProjectEntry[], counts: readonly (number | undefined)[]): string {
  const lines = projects.map((p, i) => {
    const name = path.basename(p.path) || p.path;
    const detail = isDir(p.path)
      ? `งานค้าง ${counts[i] ?? '?'} · ใช้ล่าสุด ${localDateTime(new Date(p.lastUsedAt))}`
      : '⚠ ไม่พบโฟลเดอร์';
    return `  ${i + 1}) ${name} — ${p.path} · ${detail}`;
  });
  return ['โปรเจกต์:', ...lines, MENU_HELP].join('\n');
}

/** ถาม root path จนได้โฟลเดอร์ที่ใช้ได้ คืน undefined เมื่อตอบว่าง (ยกเลิก) */
async function askNewProject(deps: ProjectMenuDeps): Promise<string | undefined> {
  const { io } = deps;
  for (;;) {
    // "Copy as path" ของ Windows ครอบ path ด้วย "
    const raw = (await io.ask(ASK_PATH)).trim().replace(/^["']|["']$/g, '');
    if (raw === '') return undefined;
    const dir = path.resolve(raw);
    const rootErr = teamRootError(dir, deps.teamRoot);
    if (rootErr) {
      io.say(rootErr);
      continue;
    }
    if (fs.existsSync(dir)) {
      if (isDir(dir)) return dir;
      io.say(`${dir} ไม่ใช่โฟลเดอร์`);
      continue;
    }
    if (!(await confirmYesNo(io, `ไม่พบโฟลเดอร์ ${dir} สร้างใหม่ไหม? (y/n)\n> `))) continue;
    await fsp.mkdir(dir, { recursive: true });
    io.say(`สร้างโฟลเดอร์ ${dir} แล้ว`);
    return dir;
  }
}
