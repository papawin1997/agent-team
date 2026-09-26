import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeInterruptHandler } from '../src/interrupt';
import { JobRepository } from '../src/jobs';

async function setup(jobId: 'created' | 'none') {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-int-'));
  const repo = new JobRepository(projectDir);
  const id = jobId === 'created' ? (await repo.create()).id : undefined;
  const calls: string[] = [];
  const printed: string[] = [];
  const exits: number[] = [];
  const handler = makeInterruptHandler({
    repo,
    getJobId: () => id,
    logger: { log: (_level, event, data) => void calls.push(`${event}:${String(data?.signal)}`) },
    abort: () => void calls.push('abort'),
    closeCli: () => void calls.push('close'),
    print: (text) => void printed.push(text),
    exit: (code) => void exits.push(code),
  });
  return { repo, id, calls, printed, exits, handler };
}

describe('makeInterruptHandler', () => {
  it.each(['SIGINT', 'SIGHUP'] as const)('%s: ปล่อย lock แบบ sync, abort, ปิด cli แล้ว exit 130', async (signal) => {
    const { repo, id, calls, printed, exits, handler } = await setup('created');

    handler(signal);

    expect(existsSync(repo.lockPath(id!))).toBe(false);
    expect(calls).toEqual([`run.interrupted:${signal}`, 'abort', 'close']);
    expect(printed).toEqual([
      `\nหยุดแล้ว — งาน ${id} ถูกบันทึกไว้ รันใหม่แล้วเลือกงานนี้จากเมนู หรือใช้ --resume`,
    ]);
    expect(exits).toEqual([130]);
  });

  it('ยังไม่ได้เลือกงาน (กดตอนอยู่ในเมนู): ไม่ throw และพิมพ์แค่ หยุดแล้ว', async () => {
    const { printed, exits, handler } = await setup('none');

    expect(() => handler('SIGINT')).not.toThrow();
    expect(printed).toEqual(['\nหยุดแล้ว']);
    expect(exits).toEqual([130]);
  });
});
