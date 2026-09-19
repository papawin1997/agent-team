import { describe, expect, it } from 'vitest';
import { runTeam } from '../src/orchestrator';
import {
  asking,
  buildState,
  makeDesign,
  makeTask,
  passReport,
  proposal,
} from './helpers/builders';
import { makeDeps } from './helpers/fakes';

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
    expect(roles(runner.calls)).toEqual(['pm', 'planning', 'pm', 'backend', 'qa', 'frontend', 'qa', 'pm']);
    expect(store.state?.phase).toBe('DONE');
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
    saved.progress.api = { rounds: 1, maxRounds: 5, done: true, acceptedWithIssues: false };
    store.state = saved;

    const final = await runTeam(deps, { resume: true });
    expect(final.phase).toBe('DONE');
    expect(roles(runner.calls)).toEqual(['frontend', 'qa', 'pm']);
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
});
