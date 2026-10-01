import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { formatJobId } from '../jobs';
import type { Handoff } from '../schemas';

export interface SavedHandoff {
  file: string;
  title: string;
  /** "YYYY-MM-DD HH:mm" จากชื่อไฟล์ */
  savedAt: string;
}

const STAMP_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\d{2}/;

const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;

/** ส่วนท้ายชื่อไฟล์จาก title: ตัดอักขระที่ Windows ใช้ในชื่อไฟล์ไม่ได้ ยาวสุด 40 ตัวอักษร */
export function handoffSlug(title: string): string {
  const cleaned = title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = Array.from(cleaned).slice(0, 40).join('');
  return slug === '' ? 'handoff' : slug;
}

/** handoff ของโหมดปรึกษา เก็บเป็น markdown ใน <project>/.agent-team/ask/ */
export class HandoffStore {
  readonly dir: string;

  constructor(
    projectDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.dir = path.join(projectDir, '.agent-team', 'ask');
  }

  async save(handoff: Handoff): Promise<string> {
    await fsp.mkdir(this.dir, { recursive: true });
    const base = `${formatJobId(this.now())}-${handoffSlug(handoff.title)}`;
    const content = `# ${handoff.title.trim()}\n\n${handoff.markdown.trim()}\n`;
    for (let n = 1; ; n++) {
      const file = path.join(this.dir, n === 1 ? `${base}.md` : `${base}-${n}.md`);
      try {
        // wx: ไม่เขียนทับ handoff เดิมที่ชื่อชนกัน
        await fsp.writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
        return file;
      } catch (e) {
        if (errCode(e) !== 'EEXIST') throw e;
      }
    }
  }

  /** ใหม่สุดก่อน (ชื่อไฟล์ขึ้นต้นด้วยเวลา) */
  async list(): Promise<SavedHandoff[]> {
    let names: string[];
    try {
      names = await fsp.readdir(this.dir);
    } catch (e) {
      if (errCode(e) === 'ENOENT') return [];
      throw e;
    }
    const files = names.filter((n) => n.endsWith('.md')).sort().reverse();
    return Promise.all(
      files.map(async (name) => {
        const file = path.join(this.dir, name);
        const firstLine = (await fsp.readFile(file, 'utf8')).split('\n', 1)[0] ?? '';
        const m = STAMP_RE.exec(name);
        return {
          file,
          title: firstLine.replace(/^#\s*/, '').trim() || name,
          savedAt: m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : '',
        };
      }),
    );
  }

  read(file: string): Promise<string> {
    return fsp.readFile(file, 'utf8');
  }
}
