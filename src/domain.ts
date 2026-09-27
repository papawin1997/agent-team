import type { Design, QAReport, QuickTask, Requirements, SecurityReport, Task } from './schemas';
import type { State, TaskProgress } from './state';

export class DesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignError';
  }
}

export function orderTasks(tasks: readonly Task[]): Task[] {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new DesignError(`task id ซ้ำ: ${task.id}`);
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (dep === task.id) throw new DesignError(`task ${task.id} พึ่งพาตัวเอง`);
      if (!ids.has(dep)) throw new DesignError(`task ${task.id} พึ่งพา ${dep} ซึ่งไม่มีอยู่`);
    }
  }
  const ordered: Task[] = [];
  const done = new Set<string>();
  let remaining = [...tasks];
  while (remaining.length > 0) {
    const next = remaining.find((t) => t.dependsOn.every((d) => done.has(d)));
    if (!next) {
      throw new DesignError(`พบ dependency วน: ${remaining.map((t) => t.id).join(', ')}`);
    }
    ordered.push(next);
    done.add(next.id);
    remaining = remaining.filter((t) => t.id !== next.id);
  }
  return ordered;
}

export function isPass(report: QAReport): boolean {
  return (
    report.verdict === 'PASS' &&
    report.checks.every((c) => c.status !== 'fail') &&
    report.issues.every((i) => i.severity === 'minor')
  );
}

export function isSecurityPass(report: SecurityReport): boolean {
  return report.verdict === 'PASS' && report.issues.every((i) => i.severity === 'minor');
}

export const QUICK_TASK_ID = 'quick';

/**
 * design สังเคราะห์ของโหมด quick: 1 task ไม่มีขั้นออกแบบ ให้ worker ทำตาม convention เดิมของโปรเจกต์
 * ถ้ามี base (design จริงของงาน full เดิมที่เพิ่งถูก triage เป็น quick) ให้ worker/QA ยังเห็น
 * architecture/apiContract/dataModel/securityNotes ของ base แทนข้อความ n/a เดิม
 */
export function quickDesign(requirements: Requirements, task: QuickTask, base?: Design): Design {
  return {
    overview: base?.overview ?? requirements.goal,
    architecture: base?.architecture ?? 'quick mode: ไม่มีขั้นออกแบบ ทำตาม task และ convention เดิมของโปรเจกต์',
    apiContract: base?.apiContract ?? 'n/a',
    dataModel: base?.dataModel ?? 'n/a',
    securityNotes: base?.securityNotes,
    tasks: [
      {
        id: QUICK_TASK_ID,
        title: task.title,
        owner: task.owner,
        dependsOn: [],
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        changed: true,
      },
    ],
  };
}

/**
 * คืนค่า design/progress ของงาน full เดิม (ก่อนถูก triage เป็น quick) ถ้าเคยเก็บไว้ใน baseDesign/baseProgress
 * แล้วล้าง base ทิ้ง — ใช้ตอนงาน quick ถูกยกระดับกลับเป็น full (PM เสนอ full ใหม่ หรือ escalate ตอน BUILD)
 * ถ้าไม่เคยมี baseDesign (เช่น เริ่มจาก quick มาแต่แรก) พฤติกรรมเดิมคือล้าง design/progress ให้ Planning เริ่มใหม่
 */
export function restoreBaseDesign(state: State): void {
  if (state.baseDesign) {
    state.design = state.baseDesign;
    state.progress = state.baseProgress ?? {};
  } else {
    state.design = undefined;
    state.progress = {};
  }
  delete state.baseDesign;
  delete state.baseProgress;
}

export function initProgress(
  design: Design,
  previous: Record<string, TaskProgress>,
  maxRounds: number,
): Record<string, TaskProgress> {
  const next: Record<string, TaskProgress> = {};
  for (const task of design.tasks) {
    const prev = previous[task.id];
    next[task.id] =
      !task.changed && prev?.done
        ? prev
        : { rounds: 0, maxRounds, done: false, acceptedWithIssues: false, securityReviewed: false };
  }
  return next;
}
