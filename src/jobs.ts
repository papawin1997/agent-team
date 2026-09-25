import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { nullLogger, type Logger } from './logger';
import { FileStateStore, newState, type State } from './state';

export interface JobLock {
  pid: number;
  startedAt: string;
}

export interface JobInfo {
  id: string;
  state: State;
  updatedAt: Date;
  /** มีค่าเมื่อ process ที่ถือ lock ยังทำงานอยู่ */
  lock?: JobLock;
}

export interface JobRepositoryOptions {
  now?: () => Date;
  log?: Logger;
  /** pid ของ process นี้ (เทสต์ส่งค่าปลอมได้) */
  pid?: number;
  /** เช็กว่า pid ยังทำงานอยู่ไหม (เทสต์ส่งค่าปลอมได้) */
  isAlive?: (pid: number) => boolean;
  /** ย้ายไฟล์/โฟลเดอร์ (เทสต์ส่งตัวที่ล้มได้) */
  rename?: (from: string, to: string) => Promise<void>;
}

const errCode = (e: unknown): string | undefined => (e as NodeJS.ErrnoException).code;
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** artifact แบบเก่าที่อยู่ที่ .agent-team/ (state.json ย้ายแยกเป็นอย่างสุดท้าย) */
const LEGACY_ARTIFACTS = ['requirements.json', 'design.json', 'reports'] as const;

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = process มีอยู่แต่เราไม่มีสิทธิ์ส่ง signal
    return errCode(e) === 'EPERM';
  }
}

export function formatJobId(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** งานที่ยังไม่มีข้อมูลอะไรเลย เช่นกด n แล้ว Ctrl+C ก่อนพิมพ์ */
export function isEmptyJob(state: State): boolean {
  return state.phase === 'REQUIREMENTS' && !state.title && !state.pmSessionId && !state.requirements;
}

function parseLock(raw: string): JobLock | undefined {
  try {
    const data = JSON.parse(raw) as Partial<JobLock>;
    if (typeof data.pid === 'number' && typeof data.startedAt === 'string') {
      return { pid: data.pid, startedAt: data.startedAt };
    }
  } catch {
    // ไฟล์ lock พัง = ถือว่าค้าง
  }
  return undefined;
}

export class JobRepository {
  readonly root: string;
  readonly jobsDir: string;
  private readonly now: () => Date;
  private readonly log: Logger;
  private readonly pid: number;
  private readonly isAlive: (pid: number) => boolean;
  private readonly rename: (from: string, to: string) => Promise<void>;

  constructor(projectDir: string, opts: JobRepositoryOptions = {}) {
    this.root = path.join(projectDir, '.agent-team');
    this.jobsDir = path.join(this.root, 'jobs');
    this.now = opts.now ?? (() => new Date());
    this.log = opts.log ?? nullLogger;
    this.pid = opts.pid ?? process.pid;
    this.isAlive = opts.isAlive ?? isProcessAlive;
    this.rename = opts.rename ?? fsp.rename;
  }

  jobDir(id: string): string {
    return path.join(this.jobsDir, id);
  }

  lockPath(id: string): string {
    return path.join(this.jobDir(id), 'run.lock');
  }

  store(id: string): FileStateStore {
    return new FileStateStore(this.jobDir(id), this.now);
  }

  async create(): Promise<{ id: string; store: FileStateStore }> {
    await fsp.mkdir(this.jobsDir, { recursive: true });
    const base = formatJobId(this.now());
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      try {
        // ไม่ recursive: EEXIST = มีงาน (หรืออีก process) ใช้ชื่อนี้แล้ว
        await fsp.mkdir(this.jobDir(id));
      } catch (e) {
        if (errCode(e) === 'EEXIST') continue;
        throw e;
      }
      // lock ก่อน state.json เพื่อไม่ให้อีก process เห็นเป็นงานเปล่าที่ไม่มีใครถือ
      if (!(await this.lock(id))) throw new Error(`lock งานใหม่ ${id} ไม่สำเร็จ`);
      const store = this.store(id);
      await store.save(newState());
      return { id, store };
    }
  }

  async list(): Promise<JobInfo[]> {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(this.jobsDir, { withFileTypes: true });
    } catch (e) {
      if (errCode(e) === 'ENOENT') return [];
      throw e;
    }
    const ids = entries.filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const jobs: JobInfo[] = [];
    for (const id of ids) {
      let state: State | undefined;
      try {
        state = await this.store(id).load();
      } catch (e) {
        this.log.log('WARN', 'job.unreadable', { jobId: id, message: errMessage(e) });
        continue;
      }
      if (!state) {
        this.log.log('WARN', 'job.missing_state', { jobId: id });
        continue;
      }
      const updatedAt = state.updatedAt
        ? new Date(state.updatedAt)
        : (await fsp.stat(path.join(this.jobDir(id), 'state.json'))).mtime;
      const lock = await this.liveLock(id);
      jobs.push(lock ? { id, state, updatedAt, lock } : { id, state, updatedAt });
    }
    return jobs;
  }

  async lock(id: string): Promise<boolean> {
    const file = this.lockPath(id);
    const body = JSON.stringify({ pid: this.pid, startedAt: this.now().toISOString() });
    if (await this.tryCreateLock(file, body)) return true;
    const held = await this.readLock(file);
    if (held?.pid === this.pid) return true;
    if (held && this.isAlive(held.pid)) return false;
    // lock ค้าง: ลบแล้วลอง wx ใหม่ 1 ครั้ง (ไม่เขียนทับ) ถ้าอีก process ชิงไปก่อนจะได้ false
    await fsp.rm(file, { force: true });
    return this.tryCreateLock(file, body);
  }

  async unlock(id: string): Promise<void> {
    const file = this.lockPath(id);
    try {
      if ((await this.readLock(file))?.pid === this.pid) await fsp.rm(file, { force: true });
    } catch (e) {
      this.log.log('WARN', 'job.unlock_failed', { jobId: id, message: errMessage(e) });
    }
  }

  /** สำหรับ signal handler ที่จบด้วย process.exit จึงต้องเสร็จแบบ sync */
  unlockSync(id: string): void {
    const file = this.lockPath(id);
    try {
      if (parseLock(fs.readFileSync(file, 'utf8'))?.pid === this.pid) fs.rmSync(file, { force: true });
    } catch (e) {
      if (errCode(e) !== 'ENOENT') {
        this.log.log('WARN', 'job.unlock_failed', { jobId: id, message: errMessage(e) });
      }
    }
  }

  async remove(id: string): Promise<void> {
    await fsp.rm(this.jobDir(id), { recursive: true, force: true });
  }

  /** ย้าย .agent-team/state.json แบบเก่า (ก่อนมีหลายงาน) เข้า jobs/<id>/ รันซ้ำได้ผลเดิม */
  async migrateLegacy(): Promise<void> {
    const legacyState = path.join(this.root, 'state.json');
    if (!fs.existsSync(legacyState)) {
      const leftovers = LEGACY_ARTIFACTS.filter((name) => fs.existsSync(path.join(this.root, name)));
      if (leftovers.length > 0) this.log.log('WARN', 'job.legacy_leftover', { files: leftovers });
      return;
    }
    let mtime: Date;
    try {
      mtime = (await fsp.stat(legacyState)).mtime;
    } catch (e) {
      if (errCode(e) === 'ENOENT') return; // อีก process ย้ายไปแล้ว
      throw e;
    }
    const id = this.legacyTarget(formatJobId(mtime));
    const dir = this.jobDir(id);
    // state.json ย้ายเป็นอย่างสุดท้าย: ถ้าล้มกลางทาง รอบหน้ายังเจอ state.json และได้ id เดิมจาก mtime
    for (const name of [...LEGACY_ARTIFACTS, 'state.json']) {
      await this.moveIfPresent(path.join(this.root, name), path.join(dir, name));
    }
    this.log.log('INFO', 'job.migrated', { jobId: id });
  }

  /** id จาก mtime; ใช้โฟลเดอร์ที่ยังไม่มี state.json ต่อได้ (ย้ายค้างจากรอบก่อน) ถ้าชนงานจริงค่อยต่อท้าย suffix */
  private legacyTarget(base: string): string {
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!fs.existsSync(path.join(this.jobDir(id), 'state.json'))) return id;
    }
  }

  private async moveIfPresent(from: string, to: string): Promise<void> {
    if (!fs.existsSync(from)) return;
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try {
      await this.rename(from, to);
    } catch (e) {
      if (errCode(e) === 'ENOENT') return; // อีก process ที่เริ่มพร้อมกันย้ายไปแล้ว
      throw new Error(`ย้าย ${from} ไป ${to} ไม่สำเร็จ: ${errMessage(e)}`);
    }
  }

  private async tryCreateLock(file: string, body: string): Promise<boolean> {
    try {
      await fsp.writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch (e) {
      if (errCode(e) === 'EEXIST') return false;
      throw e;
    }
  }

  private async readLock(file: string): Promise<JobLock | undefined> {
    try {
      return parseLock(await fsp.readFile(file, 'utf8'));
    } catch (e) {
      if (errCode(e) === 'ENOENT') return undefined;
      throw e;
    }
  }

  private async liveLock(id: string): Promise<JobLock | undefined> {
    const held = await this.readLock(this.lockPath(id));
    if (!held) return undefined;
    return held.pid === this.pid || this.isAlive(held.pid) ? held : undefined;
  }
}
