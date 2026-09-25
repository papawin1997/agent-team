import type { StateStore, UserIO } from './deps';
import { codeChangedWarning, formatJobSummary, jobTitle } from './format';
import { isEmptyJob, type JobInfo, type JobRepository } from './jobs';

export interface SelectedJob {
  id: string;
  store: StateStore;
}

const MENU_HELP = 'เลือก: r<เลข> = ทำต่องานนั้น   d<เลข> = ลบงานนั้น   n = เริ่มงานใหม่';

const isPending = (job: JobInfo): boolean =>
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
      return repo.create();
    }
    if (opts.resume) return resumeLatest(repo, io, pending);
    const picked = await menu(repo, io, pending, all);
    if (picked) return picked;
  }
}

async function removeEmptyJobs(repo: JobRepository, all: readonly JobInfo[]): Promise<void> {
  for (const job of all) {
    if (!isEmptyJob(job.state) || job.lock) continue;
    // lock ก่อนลบ: สถานะ lock ที่อ่านจาก list() อาจเก่าแล้ว
    if (await repo.lock(job.id)) await repo.remove(job.id);
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

async function confirmDelete(io: UserIO, job: JobInfo): Promise<boolean> {
  for (;;) {
    const answer = (await io.ask(`ลบงาน "${jobTitle(job.state)}" ถาวรใช่ไหม? (y/n)\n> `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    io.say('กรุณาตอบ y หรือ n');
  }
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
  if (answer === 'n' || answer === 'new') return repo.create();
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
    if (await repo.lock(job.id)) return { id: job.id, store: repo.store(job.id) };
    io.say(lockedMessage(repo, job));
    return undefined;
  }
  if (!(await confirmDelete(io, job))) return undefined;
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
