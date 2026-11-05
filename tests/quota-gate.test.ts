import { describe, expect, it } from 'vitest';
import { QuotaStopError } from '../src/errors';
import { QuotaMonitor } from '../src/quota';
import { guardAdvisor, guardRunner, QuotaGate } from '../src/quota-gate';
import { asking } from './helpers/builders';
import { makeDeps, ScriptedIO } from './helpers/fakes';

const warning = { status: 'allowed_warning' as const, rateLimitType: 'five_hour', utilization: 0.85, resetsAt: 1_790_000_000 };
const nullLog = { log: () => {} };

function setup(answers: string[]) {
  const monitor = new QuotaMonitor();
  const io = new ScriptedIO(answers);
  const gate = new QuotaGate(monitor, io, nullLog);
  return { monitor, io, gate };
}

describe('QuotaGate.check', () => {
  it('ไม่มีคำเตือน: ผ่านโดยไม่พูดอะไร', async () => {
    const { io, gate } = setup([]);
    await gate.check();
    expect(io.said).toEqual([]);
  });

  it('warning + continue: เตือน ถาม แล้วไม่ถามซ้ำ', async () => {
    const { monitor, io, gate } = setup(['continue']);
    monitor.record(warning);
    await gate.check();
    await gate.check();
    expect(io.kinds).toEqual(['warn']);
    expect(io.said[0]).toContain('โควตา 5 ชม.');
    expect(io.asked).toHaveLength(1);
    expect(io.asked[0]).toContain('handoff');
  });

  it('warning + handoff: โยน QuotaStopError reason handoff', async () => {
    const { monitor, gate } = setup(['handoff']);
    monitor.record(warning);
    await expect(gate.check()).rejects.toMatchObject({ name: 'QuotaStopError', reason: 'handoff' });
  });

  it('rejected: ไม่ถาม แจ้ง error แล้วโยน reason rejected', async () => {
    const { monitor, io, gate } = setup([]);
    monitor.record({ status: 'rejected' });
    await expect(gate.check()).rejects.toMatchObject({ reason: 'rejected' });
    expect(io.asked).toEqual([]);
    expect(io.kinds).toEqual(['error']);
  });

  it('failed(): โควตาเต็ม -> QuotaStopError ; ไม่เต็ม -> โยน error เดิม', () => {
    const { monitor, gate } = setup([]);
    const boom = new Error('boom');
    expect(() => gate.failed(boom)).toThrow(boom);
    monitor.record({ status: 'rejected' });
    expect(() => gate.failed(boom)).toThrow(QuotaStopError);
  });
});

describe('guardRunner / guardAdvisor', () => {
  it('ถามก่อนเรียก agent และเรียกต่อเมื่อ continue', async () => {
    const { deps, runner } = makeDeps({ pm: [asking('?')] }, []);
    const { monitor, io, gate } = setup(['continue']);
    monitor.record(warning);
    const guarded = guardRunner(runner, gate);
    await guarded.pmTurn({ prompt: 'x' });
    expect(io.asked).toHaveLength(1);
    expect(runner.calls).toHaveLength(1);
    expect(deps.runner).toBe(runner);
  });

  it('handoff: ไม่เรียก agent เลย', async () => {
    const { runner } = makeDeps({ pm: [asking('?')] }, []);
    const { monitor, gate } = setup(['handoff']);
    monitor.record(warning);
    await expect(guardRunner(runner, gate).pmTurn({ prompt: 'x' })).rejects.toBeInstanceOf(QuotaStopError);
    expect(runner.calls).toHaveLength(0);
  });

  it('agent ล้มระหว่างโควตาเต็ม -> QuotaStopError', async () => {
    const { monitor, gate } = setup([]);
    const advisor = {
      advise: async () => {
        monitor.record({ status: 'rejected' });
        throw new Error('rate limited');
      },
      handoff: async () => {
        throw new Error('unused');
      },
    };
    await expect(guardAdvisor(advisor, gate).advise({ prompt: 'x' })).rejects.toBeInstanceOf(QuotaStopError);
  });
});
