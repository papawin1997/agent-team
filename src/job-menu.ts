import type { StateStore, UserIO } from './deps';
import { codeChangedWarning, formatJobSummary, jobTitle } from './format';
import { confirmYesNo } from './io-util';
import { isEmptyJob, type JobInfo, type JobRepository } from './jobs';

export interface SelectedJob {
  id: string;
  store: StateStore;
}

const MENU_HELP = 'เลือก: r<เลข> = ทำต่องานนั้น   d<เลข> = ลบงานนั้น   n = เริ่มงานใหม่';

export const isPending = (job: JobInfo): boolean =>
  job.state.phase !== 'DONE' && job.state.phase !== 'ABORTED' && !isEmptyJob(job.state);

/** เลือกงานตอนเริ่มรัน งานที่คืนออกมาถูก lock ไว้แล้วเสมอ */
export async function selectJob(
  repo: JobRepository,
  io: UserIO,
  opts: { resume: boolean },
): Promise<SelectedJob> {
  await repo.migrateLegacy();
  for (;;) {
    const all = await repo.list();
    await removeEmptyJobs(repo, all);
    const pending = all.filter(isPending).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (pending.length === 0) {
      if (opts.resume) throw new Error('ไม่พบงานค้างให้ resume');
      if (!(await confirmConcurrent(io, all))) throw new Error('ยกเลิก: มีงานอื่นกำลังรันอยู่ในโปรเจกต์นี้');
      return repo.create();
    }
    if (opts.resume) {
      const running = runningJobs(all)[0];
      if (running) throw new Error(`${runningMessage(running)} — --resume ไม่เริ่มงานซ้อน ให้รันใหม่หลังงานนั้นจบ`);
      return resumeLatest(repo, io, pending);
    }
    const picked = await menu(repo, io, pending, all);
    if (picked) return picked;
  }
}

/** งานที่ process อื่นกำลังรันอยู่ (JobInfo.lock มีค่าเฉพาะเมื่อ process ที่ถือยังอยู่) */
const runningJobs = (all: readonly JobInfo[], exceptId?: string): JobInfo[] =>
  all.filter((job) => job.lock && job.id !== exceptId);

const runningMessage = (job: JobInfo): string =>
  `มีงาน "${jobTitle(job.state)}" กำลังรันอยู่ในโปรเจกต์นี้ (pid ${job.lock!.pid})`;

/** lock กันได้แค่งานเดียวกัน งานต่างกันที่รันพร้อมกันจะให้ worker แก้ไฟล์ชุดเดียวกันซ้อนกัน จึงถามก่อน */
async function confirmConcurrent(io: UserIO, all: readonly JobInfo[], exceptId?: string): Promise<boolean> {
  const running = runningJobs(all, exceptId);
  if (running.length === 0) return true;
  const more = running.length > 1 ? ` และอีก ${running.length - 1} งาน` : '';
  return confirmYesNo(io, `⚠ ${runningMessage(running[0]!)}${more} worker อาจแก้ไฟล์ชนกันได้ เริ่มต่อไหม? (y/n)\n> `);
}

async function removeEmptyJobs(repo: JobRepository, all: readonly JobInfo[]): Promise<void> {
  for (const job of all) {
    if (!isEmptyJob(job.state) || job.lock) continue;
    try {
      // lock ก่อนลบ: สถานะ lock ที่อ่านจาก list() อาจเก่าแล้ว
      if (await repo.lock(job.id)) await repo.removeQuietly(job.id);
    } catch {
      // best-effort: ห้ามทำให้ selectJob ล้ม ปล่อย lock ที่อาจถือไว้แล้วข้ามไปงานถัดไป
      await repo.unlock(job.id);
    }
  }
}

async function resumeLatest(repo: JobRepository, io: UserIO, pending: readonly JobInfo[]): Promise<SelectedJob> {
  for (const job of pending) {
    if (job.lock || !(await repo.lock(job.id))) continue;
    io.say(`ทำต่องาน "${jobTitle(job.state)}" (${job.id})`);
    return { id: job.id, store: repo.store(job.id) };
  }
  throw new Error('งานค้างทั้งหมดกำลังรันอยู่ใน process อื่น');
}

function renderMenu(pending: readonly JobInfo[], all: readonly JobInfo[]): string {
  const lines = pending.map((job, i) => formatJobSummary(job, i + 1, codeChangedWarning(job, all)));
  return [`[PM] มีงานค้าง ${pending.length} งาน:`, ...lines, MENU_HELP].join('\n');
}

function lockedMessage(repo: JobRepository, job: JobInfo): string {
  const who = job.lock ? ` (pid ${job.lock.pid})` : '';
  return (
    `งาน "${jobTitle(job.state)}" กำลังรันอยู่ใน process อื่น${who} — ` +
    `ถ้าแน่ใจว่าไม่ได้รันอยู่ ให้ลบไฟล์ ${repo.lockPath(job.id)} แล้วเลือกใหม่`
  );
}

/** คืนงานที่เลือก หรือ undefined เมื่อต้องอ่านรายการงานแล้วแสดงเมนูใหม่ (พิมพ์ผิด, หลังลบ, ยกเลิกการลบ หรือเจอ lock) */
async function menu(
  repo: JobRepository,
  io: UserIO,
  pending: readonly JobInfo[],
  all: readonly JobInfo[],
): Promise<SelectedJob | undefined> {
  io.say(renderMenu(pending, all));
  const answer = (await io.ask('> ')).trim().toLowerCase();
  if (answer === 'n' || answer === 'new') {
    return (await confirmConcurrent(io, all)) ? repo.create() : undefined;
  }
  const match = /^([rd])\s*(\d+)$/.exec(answer);
  const job = match ? pending[Number(match[2]) - 1] : undefined;
  if (!match || !job) {
    io.say(`เลือกไม่ถูกต้อง — ${MENU_HELP}`);
    return undefined;
  }
  if (job.lock) {
    io.say(lockedMessage(repo, job));
    return undefined;
  }
  if (match[1] === 'r') {
    if (!(await confirmConcurrent(io, all, job.id))) return undefined;
    if (await repo.lock(job.id)) return { id: job.id, store: repo.store(job.id) };
    io.say(lockedMessage(repo, job));
    return undefined;
  }
  if (!(await confirmYesNo(io, `ลบงาน "${jobTitle(job.state)}" ถาวรใช่ไหม? (y/n)\n> `))) return undefined;
  // lock ก่อนลบ: ระหว่างรอ user ตอบ อีก process อาจเลือกงานนี้ไปแล้ว
  if (!(await repo.lock(job.id))) {
    io.say(lockedMessage(repo, job));
    return undefined;
  }
  try {
    await repo.remove(job.id);
    io.say(`ลบงาน "${jobTitle(job.state)}" แล้ว`);
  } catch (e) {
    io.say(`ลบงานไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    await repo.unlock(job.id);
  }
  return undefined;
}
