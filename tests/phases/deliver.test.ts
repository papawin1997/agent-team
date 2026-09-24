import { describe, expect, it } from 'vitest';
import type { PmInput, UserIO } from '../../src/deps';
import { runDeliver } from '../../src/phases/deliver';
import { asking, buildState } from '../helpers/builders';
import { makeDeps } from '../helpers/fakes';

const deliverState = () => {
  const state = buildState();
  state.phase = 'DELIVER';
  return state;
};

describe('runDeliver', () => {
  it('user ตรวจรับ -> DONE', async () => {
    const { deps, io } = makeDeps({ pm: [asking('ส่งมอบครบแล้ว')] }, ['accept']);
    const state = deliverState();
    await runDeliver(deps, state);

    expect(state.phase).toBe('DONE');
    expect(io.said.join('\n')).toContain('ส่งมอบครบแล้ว');
  });

  it('user ขอแก้ -> กลับ REQUIREMENTS พร้อม pendingPrompt', async () => {
    const { deps } = makeDeps({ pm: [asking('ส่งมอบ')] }, ['change', 'เพิ่มปุ่มลบทั้งหมด']);
    const state = deliverState();
    await runDeliver(deps, state);

    expect(state.phase).toBe('REQUIREMENTS');
    expect(state.pendingPrompt).toBe('เพิ่มปุ่มลบทั้งหมด');
  });

  it('คำขอแก้ว่าง/เว้นวรรค -> ถามซ้ำจนได้ข้อความ', async () => {
    const { deps } = makeDeps({ pm: [asking('ส่งมอบ')] }, [
      'change',
      '',
      '  ',
      'เพิ่มปุ่มลบทั้งหมด',
    ]);
    const state = deliverState();
    await runDeliver(deps, state);

    expect(state.phase).toBe('REQUIREMENTS');
    expect(state.pendingPrompt).toBe('เพิ่มปุ่มลบทั้งหมด');
  });

  it('บันทึก pmSessionId ลง store ก่อนถาม user', async () => {
    const { deps, io, store } = makeDeps({ pm: [asking('ส่งมอบ')] }, ['accept']);
    let persistedAtChoose: string | undefined;
    const spyIo: UserIO = {
      say: (text) => io.say(text),
      ask: (prompt) => io.ask(prompt),
      choose: async (prompt, options) => {
        persistedAtChoose = store.state?.pmSessionId;
        return io.choose(prompt, options);
      },
    };
    const state = deliverState();
    await runDeliver({ ...deps, io: spyIo }, state);

    expect(persistedAtChoose).toBe('pm-session');
  });

  it('แจ้ง PM ว่า task ไหนรับตามสภาพ', async () => {
    const { deps, runner } = makeDeps({ pm: [asking('ส่งมอบ')] }, ['accept']);
    const state = deliverState();
    state.progress.api = {
      rounds: 5,
      maxRounds: 5,
      done: true,
      acceptedWithIssues: true,
      securityReviewed: true,
    };
    await runDeliver(deps, state);

    const prompt = (runner.calls[0]!.input as PmInput).prompt;
    expect(prompt).toContain('"id":"api"');
    expect(prompt).toContain('"acceptedWithIssues":true');
  });

  it('ส่ง securityReviewed ของแต่ละ task ไปให้ PM', async () => {
    const { deps, runner } = makeDeps({ pm: [asking('ส่งมอบ')] }, ['accept']);
    const state = deliverState();
    state.progress.api = {
      rounds: 5,
      maxRounds: 5,
      done: true,
      acceptedWithIssues: false,
      securityReviewed: true,
    };
    state.progress.ui = {
      rounds: 5,
      maxRounds: 5,
      done: true,
      acceptedWithIssues: false,
      securityReviewed: false,
    };
    await runDeliver(deps, state);

    const prompt = (runner.calls[0]!.input as PmInput).prompt;
    const summaryStart = prompt.indexOf('[');
    const summary = JSON.parse(prompt.slice(summaryStart)) as Array<{
      id: string;
      securityReviewed: boolean;
    }>;
    expect(summary.find((t) => t.id === 'api')?.securityReviewed).toBe(true);
    expect(summary.find((t) => t.id === 'ui')?.securityReviewed).toBe(false);
  });
});
