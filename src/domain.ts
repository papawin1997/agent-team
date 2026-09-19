import type { Design, QAReport, Task } from './schemas';
import type { TaskProgress } from './state';

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
        : { rounds: 0, maxRounds, done: false, acceptedWithIssues: false };
  }
  return next;
}
