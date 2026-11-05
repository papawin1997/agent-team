import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { orderTasks } from './domain';
import type { QuotaStopError } from './errors';
import { renameWithRetry } from './fs-retry';
import type { Logger } from './logger';
import type { Task } from './schemas';
import type { State, TaskProgress } from './state';

// handoff ของงาน (ส่วนที่ 3): สร้างด้วยโค้ดจาก state เท่านั้น — ไม่เรียก AI ไม่อ่าน env

export interface ChangeSummary {
  git: boolean;
  /** git diff HEAD --stat (ว่าง = ไม่มีการเปลี่ยนที่ track อยู่) */
  stat: string;
  untracked: string[];
  /** ไฟล์ที่ worker รายงานว่าแก้ (รวมทุก task) — ใช้แทน git เมื่อไม่ใช่ git repo */
  touched: string[];
}

const gitIn =
  (projectDir: string) =>
  (args: string[]): string =>
    execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export function collectChanges(projectDir: string, state: State, git = gitIn(projectDir)): ChangeSummary {
  const touched = [...new Set(Object.values(state.progress).flatMap((p) => p.touchedFiles ?? []))].sort();
  try {
    git(['rev-parse', '--is-inside-work-tree']);
    const stat = git(['diff', 'HEAD', '--stat']).trim();
    const untracked = git(['ls-files', '--others', '--exclude-standard'])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return { git: true, stat, untracked, touched };
  } catch {
    return { git: false, stat: '', untracked: [], touched };
  }
}

const bullets = (items: readonly string[]): string => (items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '-');

function taskStatus(p: TaskProgress | undefined): string {
  if (!p) return 'ยังไม่เริ่ม';
  if (p.done) return p.acceptedWithIssues ? 'เสร็จแบบรับตามสภาพ' : 'เสร็จ';
  return p.rounds > 0 ? `กำลังทำ (รอบ ${p.rounds})` : 'ยังไม่เริ่ม';
}

function safeOrder(tasks: readonly Task[]): Task[] {
  try {
    return orderTasks(tasks);
  } catch {
    return [...tasks];
  }
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function buildJobHandoff(i: {
  state: State;
  jobId: string;
  projectDir: string;
  reason: string;
  now: Date;
  changes: ChangeSummary;
}): string {
  const { state } = i;
  const req = state.requirements;
  const design = state.design;
  const tasks = design ? safeOrder(design.tasks) : [];
  const out: string[] = [
    `# Handoff: ${state.title ?? '(ไม่มีชื่องาน)'}`,
    '',
    `- งาน: ${i.jobId}`,
    `- หยุดเพราะ: ${i.reason}`,
    `- เขียนเมื่อ: ${i.now.toLocaleString('th-TH')}`,
    `- โปรเจกต์: ${i.projectDir}`,
    `- เฟสที่ค้าง: ${state.phase} · ระดับงาน: ${state.level ?? 'full'}`,
    '',
    '## เป้าหมาย',
    req?.goal ?? state.title ?? '-',
    '',
    '## Requirements',
  ];
  if (req) {
    out.push(
      '### Features',
      bullets(req.features),
      '',
      '### Constraints',
      bullets(req.constraints),
      '',
      '### Out of scope',
      bullets(req.outOfScope),
      '',
      '### Acceptance criteria',
      bullets(req.acceptanceCriteria),
    );
  } else {
    out.push('- ยังไม่ได้ยืนยัน requirements (ดูการคุยกับ PM ในข้อความล่าสุดด้านล่าง)');
  }
  out.push('', '## Design');
  if (design) {
    out.push(
      `**Overview:** ${design.overview}`,
      '',
      `**Architecture:** ${design.architecture}`,
      '',
      `**API contract:** ${design.apiContract || '-'}`,
      '',
      `**Data model:** ${design.dataModel || '-'}`,
      '',
      '**Security notes:**',
      bullets(design.securityNotes ?? []),
    );
  } else {
    out.push('-');
  }
  out.push('', '## Tasks');
  if (tasks.length > 0) {
    out.push('| id | title | owner | สถานะ | dependsOn |', '|---|---|---|---|---|');
    for (const t of tasks) {
      const deps = t.dependsOn.length > 0 ? t.dependsOn.join(', ') : '-';
      out.push(`| ${t.id} | ${cell(t.title)} | ${t.owner} | ${taskStatus(state.progress[t.id])} | ${deps} |`);
    }
  } else {
    out.push('-');
  }
  const open = tasks.filter((t) => !state.progress[t.id]?.done);
  const issues = open.flatMap((t) =>
    (state.progress[t.id]?.lastReport?.issues ?? [])
      .filter((x) => x.severity === 'blocker' || x.severity === 'major')
      .map((x) => `[${t.id}] ${x.severity} \`${x.file || '-'}\`: ${x.description} (แนะนำ: ${x.suggestedFix || '-'})`),
  );
  out.push('', '## ปัญหาค้าง', bullets(issues), '', '## ไฟล์ที่แก้ไปแล้ว (ยังไม่ได้ commit)');
  if (i.changes.git) {
    out.push(
      'การเปลี่ยนทั้งหมดใน working tree (อาจรวมการแก้ของผู้ใช้ก่อนเริ่มงาน):',
      '```',
      i.changes.stat || '(ไม่มีไฟล์ที่ track แล้วถูกแก้)',
      '```',
      'ไฟล์ใหม่ที่ยังไม่ track:',
      bullets(i.changes.untracked),
    );
  } else {
    out.push('ไม่ใช่ git repo — ไฟล์ที่ worker รายงานว่าแก้:', bullets(i.changes.touched));
  }
  out.push(
    '',
    '## ข้อความล่าสุดที่ยังไม่ได้ส่ง',
    state.pendingPrompt ?? '-',
    '',
    '## วิธีทำต่อ',
    '### ด้วย agent-team (หลังโควตารีเซ็ต)',
    '- `agent-team -r` ในโฟลเดอร์โปรเจกต์ (ทำต่องานค้างล่าสุด) หรือเปิด `agent-team` แล้วเลือกงานนี้จากเมนู',
    `- headless: \`agent-team run --headless --project "${i.projectDir}" --job ${i.jobId}\``,
    '',
    '### ด้วย AI ตัวอื่นหรือคนทำต่อ',
  );
  if (open.length > 0) {
    out.push('ทำ task ที่ค้างตามลำดับนี้ (เรียงตาม dependency แล้ว):');
    open.forEach((t, n) => {
      out.push(
        `${n + 1}. ${t.id} — ${t.title}`,
        `   ${t.description.replace(/\n/g, ' ')}`,
        ...t.acceptanceCriteria.map((c) => `   - ${c}`),
      );
    });
  } else if (state.quickTask && tasks.length === 0) {
    out.push(
      `1. ${state.quickTask.title}`,
      `   ${state.quickTask.description}`,
      ...state.quickTask.acceptanceCriteria.map((c) => `   - ${c}`),
    );
  } else {
    out.push('- ยังไม่มี task ที่ต้องทำ: เริ่มจากยืนยัน requirements และออกแบบตามหัวข้อด้านบน');
  }
  out.push(
    '',
    `- ตรวจงานด้วยคำสั่ง build/lint/test ของโปรเจกต์ ผล QA ล่าสุดของแต่ละ task อยู่ใน \`.agent-team/jobs/${i.jobId}/reports/\``,
    `- ข้อมูลอ้างอิง: \`.agent-team/jobs/${i.jobId}/state.json\`, \`design.json\`, \`requirements.json\``,
    '- ห้ามแก้ไฟล์ใน `.agent-team/` ถ้าจะกลับมาใช้ agent-team ทำต่อ',
    '',
  );
  return out.join('\n');
}

export async function saveJobHandoff(o: {
  jobDir: string;
  jobId: string;
  projectDir: string;
  state: State;
  reason: string;
  now?: Date;
  changes?: ChangeSummary;
}): Promise<string> {
  const file = path.join(o.jobDir, 'handoff.md');
  const markdown = buildJobHandoff({
    state: o.state,
    jobId: o.jobId,
    projectDir: o.projectDir,
    reason: o.reason,
    now: o.now ?? new Date(),
    changes: o.changes ?? collectChanges(o.projectDir, o.state),
  });
  const tmp = `${file}.tmp`;
  await fs.mkdir(o.jobDir, { recursive: true });
  await fs.writeFile(tmp, markdown, 'utf8');
  await renameWithRetry(tmp, file);
  return file;
}

/** หยุดเพราะโควตา: มีงาน = เขียน handoff.md ; ยังไม่มีงาน (ask) = แสดงข้อความที่ยังไม่ได้ส่ง — คืนบรรทัดที่ต้องพิมพ์ */
export async function handleQuotaStop(o: {
  error: QuotaStopError;
  jobId?: string;
  repo: { jobDir(id: string): string; store(id: string): { load(): Promise<State | undefined> } };
  projectDir: string;
  logger: Logger;
}): Promise<{ lines: string[]; handoffPath?: string }> {
  const lines = [`หยุดเพราะโควตา: ${o.error.message}`];
  if (o.error.pendingText) lines.push(`ข้อความล่าสุดที่ยังไม่ได้ส่ง: ${o.error.pendingText}`);
  if (!o.jobId) {
    o.logger.log('WARN', 'quota.handoff', { reason: o.error.reason });
    return { lines };
  }
  const state = await o.repo.store(o.jobId).load();
  if (!state) return { lines };
  const handoffPath = await saveJobHandoff({
    jobDir: o.repo.jobDir(o.jobId),
    jobId: o.jobId,
    projectDir: o.projectDir,
    state,
    reason: o.error.message,
  });
  o.logger.log('WARN', 'quota.handoff', { jobId: o.jobId, path: handoffPath, reason: o.error.reason });
  lines.push(
    `เขียน handoff ที่ ${handoffPath} (ให้ AI ตัวอื่นหรือคนอ่านทำต่อได้)`,
    'ทำต่อด้วย agent-team หลังโควตารีเซ็ต: agent-team -r',
  );
  return { lines, handoffPath };
}
