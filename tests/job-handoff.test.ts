import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { QuotaStopError } from '../src/errors';
import { buildJobHandoff, type ChangeSummary, collectChanges, handleQuotaStop, saveJobHandoff } from '../src/job-handoff';
import { newState } from '../src/state';
import { buildState, failReport, makeDesign, makeTask } from './helpers/builders';
import { MemoryStore } from './helpers/fakes';

const now = new Date(2026, 10, 5, 14, 0);
const noGit: ChangeSummary = { git: false, stat: '', untracked: [], touched: [] };
const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'job-handoff-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const build = (state = newState(), changes = noGit) =>
  buildJobHandoff({ state, jobId: 'job-1', projectDir: 'C:/proj', reason: '⚠ โควตา 5 ชม. · รีเซ็ต 16:30', now, changes });

describe('buildJobHandoff', () => {
  it('REQUIREMENTS ยังไม่มี requirements/design: ครบทุกหัวข้อ ไม่ล้ม', () => {
    const md = build({ ...newState(), title: 'ระบบ login', pendingPrompt: 'เพิ่ม OTP' });
    expect(md).toContain('# Handoff: ระบบ login');
    expect(md).toContain('- งาน: job-1');
    expect(md).toContain('- หยุดเพราะ: ⚠ โควตา 5 ชม. · รีเซ็ต 16:30');
    expect(md).toContain('- เฟสที่ค้าง: REQUIREMENTS');
    expect(md).toContain('ยังไม่ได้ยืนยัน requirements');
    expect(md).toContain('## ข้อความล่าสุดที่ยังไม่ได้ส่ง\nเพิ่ม OTP');
    expect(md).toContain('agent-team -r');
    expect(md).toContain('ห้ามแก้ไฟล์ใน `.agent-team/`');
  });

  it('BUILD: ตาราง task ตามลำดับ dependency พร้อมสถานะ และปัญหาค้างของ task ที่ยังไม่เสร็จ', () => {
    const state = buildState(makeDesign([makeTask('api'), makeTask('web', 'frontend', ['api'])]));
    state.progress.api!.done = true;
    state.progress.web!.rounds = 2;
    state.progress.web!.lastReport = failReport('web');
    const md = build(state);
    expect(md).toContain('| api | task api | backend | เสร็จ | - |');
    expect(md).toContain('| web | task web | frontend | กำลังทำ (รอบ 2) | api |');
    expect(md).toContain('[web] major `src/x.ts`: ผิด (แนะนำ: แก้)');
    expect(md).toContain('1. web — task web');
    expect(md).toContain('   - web ทำงานถูกต้อง');
    expect(md).not.toContain('1. api');
  });

  it('git: แสดง diff --stat และไฟล์ใหม่ ; ไม่ใช่ git: ใช้ touchedFiles', () => {
    const git = build(newState(), { git: true, stat: ' src/a.ts | 3 ++-', untracked: ['src/new.ts'], touched: [] });
    expect(git).toContain('src/a.ts | 3 ++-');
    expect(git).toContain('- src/new.ts');
    expect(git).toContain('อาจรวมการแก้ของผู้ใช้ก่อนเริ่มงาน');
    const plain = build(newState(), { ...noGit, touched: ['src/b.ts'] });
    expect(plain).toContain('- src/b.ts');
  });
});

describe('collectChanges', () => {
  it('git สำเร็จ: เก็บ stat และไฟล์ untracked', () => {
    const outputs: Record<string, string> = {
      'rev-parse --is-inside-work-tree': 'true\n',
      'diff HEAD --stat': ' src/a.ts | 1 +\n',
      'ls-files --others --exclude-standard': 'src/new.ts\n\n',
    };
    const out = collectChanges('C:/proj', newState(), (args) => outputs[args.join(' ')] ?? '');
    expect(out).toEqual({ git: true, stat: 'src/a.ts | 1 +', untracked: ['src/new.ts'], touched: [] });
  });

  it('ไม่ใช่ git (คำสั่งล้ม): git=false และรวม touchedFiles ทุก task', () => {
    const state = buildState();
    state.progress.api!.touchedFiles = ['src/b.ts', 'src/a.ts'];
    state.progress.ui!.touchedFiles = ['src/a.ts'];
    const out = collectChanges('C:/proj', state, () => {
      throw new Error('not a git repository');
    });
    expect(out).toEqual({ git: false, stat: '', untracked: [], touched: ['src/a.ts', 'src/b.ts'] });
  });
});

describe('saveJobHandoff / handleQuotaStop', () => {
  it('เขียน handoff.md แบบ atomic แล้วคืน path', async () => {
    const dir = tmp();
    const file = await saveJobHandoff({ jobDir: dir, jobId: 'job-1', projectDir: dir, state: newState(), reason: 'x', changes: noGit });
    expect(file).toBe(path.join(dir, 'handoff.md'));
    expect(fs.readFileSync(file, 'utf8')).toContain('# Handoff:');
    expect(fs.readdirSync(dir)).toEqual(['handoff.md']);
  });

  it('มีงาน: เขียน handoff, log quota.handoff และบอกวิธีทำต่อ', async () => {
    const dir = tmp();
    const store = new MemoryStore();
    store.state = { ...newState(), title: 'งาน A' };
    const events: string[] = [];
    const out = await handleQuotaStop({
      error: new QuotaStopError('handoff', '⚠ โควตา 5 ชม.'),
      jobId: 'job-1',
      repo: { jobDir: () => dir, store: () => store },
      projectDir: dir,
      logger: { log: (_l, event) => void events.push(event) },
    });
    expect(out.handoffPath).toBe(path.join(dir, 'handoff.md'));
    expect(out.lines.join('\n')).toContain(out.handoffPath!);
    expect(out.lines.join('\n')).toContain('agent-team -r');
    expect(events).toContain('quota.handoff');
  });

  it('ยังไม่มีงาน (โหมด ask): ไม่เขียนไฟล์ แต่แสดงข้อความที่ยังไม่ได้ส่ง', async () => {
    const error = new QuotaStopError('rejected', 'โควตาเต็มแล้ว');
    error.pendingText = 'คำถามค้าง';
    const out = await handleQuotaStop({
      error,
      repo: { jobDir: () => '', store: () => new MemoryStore() },
      projectDir: tmp(),
      logger: { log: () => {} },
    });
    expect(out.handoffPath).toBeUndefined();
    expect(out.lines.join('\n')).toContain('คำถามค้าง');
  });
});
