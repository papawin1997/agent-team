import { describe, expect, it } from 'vitest';
import { DesignError, initProgress, isPass, isSecurityPass, orderTasks } from '../src/domain';
import { failReport, makeDesign, makeTask, passReport } from './helpers/builders';

describe('orderTasks', () => {
  it('เรียง task ที่ถูกพึ่งพาไว้ก่อน', () => {
    const ordered = orderTasks([makeTask('ui', 'frontend', ['api']), makeTask('api')]);
    expect(ordered.map((t) => t.id)).toEqual(['api', 'ui']);
  });

  it('คงลำดับเดิมเมื่อไม่มี dependency', () => {
    const ordered = orderTasks([makeTask('b'), makeTask('a')]);
    expect(ordered.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('โยน DesignError เมื่อ id ซ้ำ', () => {
    expect(() => orderTasks([makeTask('a'), makeTask('a')])).toThrow(DesignError);
  });

  it('โยน DesignError เมื่ออ้าง id ที่ไม่มี', () => {
    expect(() => orderTasks([makeTask('a', 'backend', ['zzz'])])).toThrow('zzz');
  });

  it('โยน DesignError เมื่อพึ่งตัวเอง', () => {
    expect(() => orderTasks([makeTask('a', 'backend', ['a'])])).toThrow(DesignError);
  });

  it('โยน DesignError เมื่อ dependency วน', () => {
    const cyclic = [makeTask('a', 'backend', ['b']), makeTask('b', 'backend', ['a'])];
    expect(() => orderTasks(cyclic)).toThrow('dependency วน');
  });
});

describe('isPass', () => {
  it('PASS ที่ไม่มีปัญหา = ผ่าน', () => {
    expect(isPass(passReport('a'))).toBe(true);
  });

  it('FAIL = ไม่ผ่าน', () => {
    expect(isPass(failReport('a'))).toBe(false);
  });

  it('PASS แต่มี blocker = ไม่ผ่าน', () => {
    const report = { ...passReport('a'), issues: failReport('a', 'blocker').issues };
    expect(isPass(report)).toBe(false);
  });

  it('PASS แต่มี check ที่ fail = ไม่ผ่าน', () => {
    const report = { ...passReport('a'), checks: [{ name: 'test' as const, status: 'fail' as const, output: 'x' }] };
    expect(isPass(report)).toBe(false);
  });

  it('PASS ที่มีแค่ minor issue = ผ่าน', () => {
    const report = { ...passReport('a'), issues: failReport('a', 'minor').issues };
    expect(isPass(report)).toBe(true);
  });
});

describe('initProgress', () => {
  it('สร้าง progress ใหม่ให้ทุก task', () => {
    const progress = initProgress(makeDesign(), {}, 5);
    expect(progress.api).toEqual({ rounds: 0, maxRounds: 5, done: false, acceptedWithIssues: false });
    expect(Object.keys(progress)).toEqual(['api', 'ui']);
  });

  it('เก็บ progress ที่เสร็จแล้วของ task ที่ changed=false', () => {
    const design = makeDesign([makeTask('api', 'backend', [], false), makeTask('ui', 'frontend', ['api'])]);
    const previous = {
      api: { rounds: 2, maxRounds: 5, done: true, acceptedWithIssues: false },
      ui: { rounds: 1, maxRounds: 5, done: true, acceptedWithIssues: false },
    };
    const progress = initProgress(design, previous, 5);
    expect(progress.api?.done).toBe(true);
    expect(progress.ui?.done).toBe(false);
    expect(progress.ui?.rounds).toBe(0);
  });

  it('task ที่ changed=false แต่ยังไม่เคยเสร็จ ต้องเริ่มใหม่', () => {
    const design = makeDesign([makeTask('api', 'backend', [], false)]);
    const progress = initProgress(design, {}, 5);
    expect(progress.api?.done).toBe(false);
  });
});

describe('isSecurityPass', () => {
  it('PASS ที่ไม่มีปัญหา = ผ่าน', () => {
    expect(isSecurityPass({ taskId: 'a', verdict: 'PASS', issues: [] })).toBe(true);
  });

  it('FAIL = ไม่ผ่าน', () => {
    const report = {
      taskId: 'a',
      verdict: 'FAIL' as const,
      issues: [{ severity: 'major' as const, file: 'x', description: 'd', suggestedFix: 'f' }],
    };
    expect(isSecurityPass(report)).toBe(false);
  });

  it('PASS แต่มี blocker = ไม่ผ่าน', () => {
    const report = {
      taskId: 'a',
      verdict: 'PASS' as const,
      issues: [{ severity: 'blocker' as const, file: 'x', description: 'd', suggestedFix: 'f' }],
    };
    expect(isSecurityPass(report)).toBe(false);
  });

  it('PASS ที่มีแค่ minor issue = ผ่าน', () => {
    const report = {
      taskId: 'a',
      verdict: 'PASS' as const,
      issues: [{ severity: 'minor' as const, file: 'x', description: 'd', suggestedFix: 'f' }],
    };
    expect(isSecurityPass(report)).toBe(true);
  });
});
