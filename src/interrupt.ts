import type { JobRepository } from './jobs';
import type { Logger } from './logger';

export interface InterruptDeps {
  repo: Pick<JobRepository, 'unlockSync'>;
  /** ยังไม่มีค่าเมื่อกด Ctrl+C ตอนอยู่ในเมนูเลือกงาน */
  getJobId: () => string | undefined;
  logger: Logger;
  abort: () => void;
  closeCli: () => void;
  print: (text: string) => void;
  /** index.ts ส่ง process.exit เทสต์ส่งตัวปลอม */
  exit: (code: number) => void;
}

/** SIGTERM/stop ใช้ในโหมด headless (stop = เจอ stop.json จากคำสั่ง agent-team stop) */
export type InterruptSignal = 'SIGINT' | 'SIGHUP' | 'SIGTERM' | 'stop';

/** handler เดียวใช้กับทุกสัญญาณหยุด ทุกขั้นเป็น sync เพราะจบด้วย exit */
export function makeInterruptHandler(deps: InterruptDeps): (signal: InterruptSignal) => void {
  return (signal) => {
    deps.logger.log('WARN', 'run.interrupted', { signal });
    deps.abort();
    const jobId = deps.getJobId();
    if (jobId) deps.repo.unlockSync(jobId);
    deps.closeCli();
    deps.print(
      jobId
        ? `\nหยุดแล้ว — งาน ${jobId} ถูกบันทึกไว้ รันใหม่แล้วเลือกงานนี้จากเมนู หรือใช้ --resume`
        : '\nหยุดแล้ว',
    );
    deps.exit(130);
  };
}
