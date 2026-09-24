import { initProgress } from '../../src/domain';
import type { Design, PmTurn, QAReport, Requirements, SecurityReport, Task } from '../../src/schemas';
import { newState, type State } from '../../src/state';

export function makeRequirements(): Requirements {
  return {
    goal: 'todo list',
    features: ['เพิ่ม/ลบ todo'],
    constraints: [],
    outOfScope: [],
    acceptanceCriteria: ['เพิ่ม todo แล้วเห็นในรายการ'],
  };
}

export function makeTask(
  id: string,
  owner: Task['owner'] = 'backend',
  dependsOn: string[] = [],
  changed = true,
): Task {
  return {
    id,
    title: `task ${id}`,
    owner,
    dependsOn,
    description: `ทำ ${id}`,
    acceptanceCriteria: [`${id} ทำงานถูกต้อง`],
    changed,
  };
}

export function makeDesign(
  tasks: Task[] = [makeTask('api'), makeTask('ui', 'frontend', ['api'])],
): Design {
  return {
    overview: 'ภาพรวมของระบบ',
    architecture: 'client-server',
    apiContract: 'GET /todos',
    dataModel: 'Todo { id, text }',
    tasks,
  };
}

export function passReport(taskId: string): QAReport {
  return {
    taskId,
    verdict: 'PASS',
    checks: [{ name: 'test', status: 'pass', output: 'ok' }],
    issues: [],
    testsAdded: [],
  };
}

export function failReport(
  taskId: string,
  severity: 'blocker' | 'major' | 'minor' = 'major',
): QAReport {
  return {
    taskId,
    verdict: 'FAIL',
    checks: [{ name: 'test', status: 'fail', output: '1 failed' }],
    issues: [{ severity, file: 'src/x.ts', description: 'ผิด', suggestedFix: 'แก้' }],
    testsAdded: [],
  };
}

export function passSecurityReport(taskId: string): SecurityReport {
  return { taskId, verdict: 'PASS', issues: [] };
}

export function failSecurityReport(
  taskId: string,
  severity: 'blocker' | 'major' | 'minor' = 'major',
): SecurityReport {
  return {
    taskId,
    verdict: 'FAIL',
    issues: [{ severity, file: 'src/x.ts', description: 'มีช่องโหว่', suggestedFix: 'แก้' }],
  };
}

export const asking = (message: string): PmTurn => ({ message, status: 'asking' });

export const proposal = (
  requirements: Requirements = makeRequirements(),
  message = 'สรุป requirements',
): PmTurn => ({ message, status: 'proposal', requirements });

export function buildState(design: Design = makeDesign()): State {
  const state = newState();
  state.phase = 'BUILD';
  state.requirements = makeRequirements();
  state.design = design;
  state.progress = initProgress(design, {}, 5);
  return state;
}
