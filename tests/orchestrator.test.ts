import { describe, expect, it } from 'vitest';
import { runTeam } from '../src/orchestrator';
import {
  asking,
  buildState,
  failReport,
  makeDesign,
  makeTask,
  passReport,
  proposal,
} from './helpers/builders';
import { makeDeps, ScriptedIO } from './helpers/fakes';

const roles = (calls: { role: string }[]) => calls.map((c) => c.role);

describe('runTeam', () => {
  it('flow เต็ม: requirements -> design -> review -> build/QA -> deliver -> DONE', async () => {
    const { deps, runner, store } = makeDeps(
      {
        pm: [proposal(), asking('สรุป design'), asking('สรุปส่งมอบ')],
        plans: [makeDesign()],
        qa: [passReport('api'), passReport('ui')],
      },
      ['อยากได้ todo', 'confirm', 'confirm', 'accept'],
    );
    const final = await runTeam(deps, { resume: false });

    expect(final.phase).toBe('DONE');
    expect(roles(runner.calls)).toEqual([
      'pm',
      'planning',
      'security',
      'pm',
      'backend',
      'qa',
      'security',
      'frontend',
      'qa',
      'security',
      'pm',
    ]);
    expect(store.state?.phase).toBe('DONE');
  });

  it('บันทึก log ทุกครั้งที่เปลี่ยน phase และตอนจบ', async () => {
    const events: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const { deps } = makeDeps(
      {
        pm: [proposal(), asking('สรุป design'), asking('สรุปส่งมอบ')],
        plans: [makeDesign()],
        qa: [passReport('api'), passReport('ui')],
      },
      ['อยากได้ todo', 'confirm', 'confirm', 'accept'],
    );
    deps.log = { log: (_level, event, data) => void events.push({ event, data: data as never }) };
    await runTeam(deps, { resume: false });

    const changes = events.filter((e) => e.event === 'phase.change').map((e) => `${e.data?.from}>${e.data?.to}`);
    expect(changes).toEqual([
      'REQUIREMENTS>DESIGN',
      'DESIGN>REVIEW',
      'REVIEW>BUILD',
      'BUILD>DELIVER',
      'DELIVER>DONE',
    ]);
    expect(events.at(-1)).toMatchObject({ event: 'team.end', data: { phase: 'DONE' } });
  });

  it('user ขอแก้แบบ: วนกลับไปเฟส 1-3 แล้วค่อย build', async () => {
    const { deps, runner } = makeDeps(
      {
        pm: [proposal(), asking('design v1'), proposal(), asking('design v2'), asking('ส่งมอบ')],
        plans: [makeDesign(), makeDesign()],
        qa: [passReport('api'), passReport('ui')],
      },
      ['อยากได้ todo', 'confirm', 'revise', 'เพิ่มการค้นหา', 'confirm', 'confirm', 'accept'],
    );
    const final = await runTeam(deps, { resume: false });

    expect(final.phase).toBe('DONE');
    expect(roles(runner.calls).filter((r) => r === 'planning')).toHaveLength(2);
    expect(roles(runner.calls).filter((r) => r === 'backend')).toHaveLength(1);
  });

  it('user ขอแก้หลังรับงาน: ทำเฉพาะ task ที่เปลี่ยน', async () => {
    const changed = makeDesign([
      makeTask('api', 'backend', [], false),
      makeTask('ui', 'frontend', ['api']),
    ]);
    const { deps, runner } = makeDeps(
      {
        pm: [
          proposal(),
          asking('design v1'),
          asking('ส่งมอบ v1'),
          proposal(),
          asking('design v2'),
          asking('ส่งมอบ v2'),
        ],
        plans: [makeDesign(), changed],
        qa: [passReport('api'), passReport('ui'), passReport('ui')],
      },
      ['อยากได้ todo', 'confirm', 'confirm', 'change', 'ปรับหน้าตา', 'confirm', 'confirm', 'accept'],
    );
    const final = await runTeam(deps, { resume: false });

    expect(final.phase).toBe('DONE');
    expect(runner.calls.filter((c) => c.role === 'backend')).toHaveLength(1);
    expect(runner.calls.filter((c) => c.role === 'frontend')).toHaveLength(2);
    expect(final.progress.api?.rounds).toBe(1);
    const pmCalls = runner.calls.filter((c) => c.role === 'pm');
    const secondReqPrompt = (pmCalls[3]?.input as any)?.prompt ?? '';
    expect(secondReqPrompt).toContain('ปรับหน้าตา');
  });

  it('user ยกเลิกตอน escalate -> ABORTED', async () => {
    const { deps } = makeDeps(
      {
        pm: [proposal(), asking('design'), asking('ค้าง')],
        plans: [makeDesign([makeTask('api')])],
        qa: Array.from({ length: 5 }, () => ({ ...passReport('api'), verdict: 'FAIL' as const })),
      },
      ['อยากได้ todo', 'confirm', 'confirm', 'abort'],
    );
    const final = await runTeam(deps, { resume: false });
    expect(final.phase).toBe('ABORTED');
  });

  it('abort ตอน escalate: ไม่ทำ task ถัดไปที่ depends on และไม่ mark done', async () => {
    const { deps, runner } = makeDeps(
      {
        pm: [proposal(), asking('design'), asking('ค้าง')],
        plans: [makeDesign([makeTask('api'), makeTask('ui', 'frontend', ['api'])])],
        qa: Array.from({ length: 5 }, () => ({ ...passReport('api'), verdict: 'FAIL' as const })),
      },
      ['อยากได้ todo', 'confirm', 'confirm', 'abort'],
    );
    const final = await runTeam(deps, { resume: false });

    expect(final.phase).toBe('ABORTED');
    expect(roles(runner.calls)).not.toContain('frontend');
    expect(final.progress.ui?.done).toBe(false);
  });

  it('resume: ทำต่อจาก state ที่บันทึกไว้ โดยไม่ทำ task ที่เสร็จแล้วซ้ำ', async () => {
    const { deps, runner, store } = makeDeps(
      { qa: [passReport('ui')], pm: [asking('สรุปส่งมอบ')] },
      ['accept'],
    );
    const saved = buildState();
    saved.progress.api = {
      rounds: 1,
      maxRounds: 5,
      done: true,
      acceptedWithIssues: false,
      securityReviewed: false,
    };
    store.state = saved;

    const final = await runTeam(deps, { resume: true });
    expect(final.phase).toBe('DONE');
    expect(roles(runner.calls)).toEqual(['frontend', 'qa', 'security', 'pm']);
  });

  it('resume โดยไม่มี state -> error', async () => {
    const { deps } = makeDeps({}, []);
    await expect(runTeam(deps, { resume: true })).rejects.toThrow('ไม่พบ state');
  });

  it('เริ่มใหม่ทั้งที่มีงานค้าง -> error บอกให้ใช้ --resume', async () => {
    const { deps, store } = makeDeps({}, []);
    store.state = buildState();
    await expect(runTeam(deps, { resume: false })).rejects.toThrow('--resume');
  });

  it.each([
    { existingPhase: 'DONE' as const, staleData: true },
    { existingPhase: 'ABORTED' as const, staleData: true },
  ])(
    'เริ่มใหม่จากสถานะ $existingPhase ด้วย resume: false -> ทำความสะอาดข้อมูลเก่า',
    async ({ existingPhase }) => {
      const staleState = buildState();
      staleState.phase = existingPhase;
      staleState.requirements = {
        goal: 'stale goal',
        features: ['stale'],
        constraints: [],
        outOfScope: [],
        acceptanceCriteria: [],
      };
      staleState.pmSessionId = 'old-session';
      staleState.pendingPrompt = 'old prompt';

      const { deps, runner, store } = makeDeps(
        {
          pm: [proposal(), asking('สรุป design'), asking('สรุปส่งมอบ')],
          plans: [makeDesign()],
          qa: [passReport('api'), passReport('ui')],
        },
        ['อยากได้ todo', 'confirm', 'confirm', 'accept'],
      );
      store.state = staleState;

      const final = await runTeam(deps, { resume: false });

      expect(final.phase).toBe('DONE');
      expect(final.requirements?.goal).toBe('todo list');
      expect(final.pmSessionId).not.toBe('old-session');
      expect(final.pendingPrompt).toBeUndefined();
      const firstPmCall = runner.calls.find((c) => c.role === 'pm');
      const firstPrompt = (firstPmCall?.input as any)?.prompt ?? '';
      expect(firstPrompt).not.toContain('stale goal');
    },
  );

  it('initial state is saved when first ask throws', async () => {
    const { deps, store } = makeDeps({}, []);
    const io = new ScriptedIO([]);
    deps.io = io;

    await expect(runTeam(deps, { resume: false })).rejects.toThrow();
    expect(store.state?.phase).toBe('REQUIREMENTS');
    expect(store.saves).toBeGreaterThanOrEqual(1);
  });

  it('unknown phase throws exhaustiveness guard error', async () => {
    const { deps, store } = makeDeps({}, []);
    const bogusState = buildState();
    (bogusState as any).phase = 'BOGUS';
    store.state = bogusState;

    await expect(runTeam(deps, { resume: true })).rejects.toThrow('BOGUS');
  });

  it('resume จาก DELIVER phase: รับงาน -> DONE', async () => {
    const { deps, runner, store } = makeDeps(
      { pm: [asking('สรุปส่งมอบ')] },
      ['accept'],
    );
    const saved = buildState();
    saved.phase = 'DELIVER';
    saved.progress.api = {
      rounds: 1,
      maxRounds: 5,
      done: true,
      acceptedWithIssues: false,
      securityReviewed: false,
    };
    saved.progress.ui = {
      rounds: 1,
      maxRounds: 5,
      done: true,
      acceptedWithIssues: false,
      securityReviewed: false,
    };
    store.state = saved;

    const final = await runTeam(deps, { resume: true });
    expect(final.phase).toBe('DONE');
    expect(roles(runner.calls)).toEqual(['pm']);
  });

  it('resume จาก REQUIREMENTS ด้วย pendingPrompt: ใช้ pendingPrompt ในการออกแบบใหม่', async () => {
    const { deps: origDeps, runner } = makeDeps(
      {
        pm: [proposal(), asking('design'), asking('ส่งมอบ')],
        plans: [makeDesign()],
        qa: [passReport('api'), passReport('ui')],
      },
      ['confirm', 'confirm', 'accept'],
    );

    const saved = buildState();
    saved.phase = 'REQUIREMENTS';
    saved.requirements = {
      goal: 'todo list',
      features: ['เพิ่ม/ลบ todo'],
      constraints: [],
      outOfScope: [],
      acceptanceCriteria: ['เพิ่ม todo แล้วเห็นในรายการ'],
    };
    saved.pendingPrompt = 'แก้ให้มี login';
    // Clear progress to start fresh from REQUIREMENTS
    saved.progress = {};

    const memStore = { state: undefined as any };
    const deps = {
      runner: runner,
      io: origDeps.io,
      store: {
        load: async () => saved,
        save: async (s: any) => {
          memStore.state = s;
        },
        saveArtifact: async () => {},
      },
      config: origDeps.config,
    };

    const final = await runTeam(deps as any, { resume: true });
    expect(final.phase).toBe('DONE');
    const pmCalls = runner.calls.filter((c) => c.role === 'pm');
    const firstReqPrompt = (pmCalls[0]?.input as any)?.prompt ?? '';
    expect(firstReqPrompt).toContain('แก้ให้มี login');
  });
});
