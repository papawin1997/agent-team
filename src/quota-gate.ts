import type { AdvisorRunner, RoleRunner, UserIO } from './deps';
import { QuotaStopError } from './errors';
import type { Logger } from './logger';
import { formatQuotaAlert, type QuotaMonitor } from './quota';

const QUESTION = 'จะทำอย่างไรต่อ? (handoff = หยุดแล้วเขียนไฟล์ส่งต่องาน, continue = ทำต่อ)\n> ';

/** จุดปลอดภัย: เช็คโควตาก่อนเรียก agent ทุกครั้ง (ไม่ตัด agent กลางการเรียก) */
export class QuotaGate {
  constructor(
    private readonly monitor: QuotaMonitor,
    private readonly io: Pick<UserIO, 'say' | 'choose'>,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async check(): Promise<void> {
    const alert = this.monitor.pending();
    if (!alert) return;
    const text = formatQuotaAlert(alert, this.now());
    this.log.log('WARN', 'quota.alert', { kind: alert.kind, ...alert.info });
    if (alert.kind === 'rejected') {
      this.io.say(text, 'error');
      throw new QuotaStopError('rejected', text);
    }
    this.io.say(text, 'warn');
    const answer = await this.io.choose(QUESTION, ['handoff', 'continue'] as const);
    this.log.log('INFO', 'quota.decision', { kind: alert.kind, answer });
    if (answer === 'handoff') throw new QuotaStopError('handoff', text);
    this.monitor.acknowledge(alert);
  }

  /** การเรียก agent ล้ม: ถ้าเป็นเพราะโควตาเต็ม แปลงเป็น QuotaStopError ไม่งั้นโยน error เดิม */
  failed(e: unknown): never {
    if (!(e instanceof QuotaStopError) && this.monitor.isRejected()) {
      const alert = this.monitor.pending() ?? { kind: 'rejected' as const, info: { status: 'rejected' as const } };
      const text = formatQuotaAlert(alert, this.now());
      this.io.say(text, 'error');
      throw new QuotaStopError('rejected', text);
    }
    throw e;
  }

  async run<T>(call: () => Promise<T>): Promise<T> {
    await this.check();
    try {
      return await call();
    } catch (e) {
      return this.failed(e);
    }
  }
}

export function guardRunner(runner: RoleRunner, gate: QuotaGate): RoleRunner {
  return {
    pmTurn: (input) => gate.run(() => runner.pmTurn(input)),
    plan: (input) => gate.run(() => runner.plan(input)),
    work: (input) => gate.run(() => runner.work(input)),
    qa: (input) => gate.run(() => runner.qa(input)),
    securityDesign: (input) => gate.run(() => runner.securityDesign(input)),
    security: (input) => gate.run(() => runner.security(input)),
  };
}

export function guardAdvisor(runner: AdvisorRunner, gate: QuotaGate): AdvisorRunner {
  return {
    advise: (input) => gate.run(() => runner.advise(input)),
    handoff: (sessionId) => gate.run(() => runner.handoff(sessionId)),
  };
}
