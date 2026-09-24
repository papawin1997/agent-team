import { describe, expect, it } from 'vitest';
import {
  DesignSchema,
  PmTurnSchema,
  QAIssueSchema,
  QAReportSchema,
  RequirementsSchema,
  SecurityDesignReviewSchema,
  SecurityReportSchema,
  TaskSchema,
  WorkerResultSchema,
  toJsonSchema,
} from '../src/schemas';

const validRequirements = {
  goal: 'todo list',
  features: ['เพิ่ม/ลบ todo'],
  constraints: [],
  outOfScope: [],
  acceptanceCriteria: ['เพิ่ม todo แล้วเห็นในรายการ'],
};

const validTask = {
  id: 'api-todos',
  title: 'API todos',
  owner: 'backend',
  dependsOn: [],
  description: 'สร้าง endpoint',
  acceptanceCriteria: ['GET /todos คืนรายการ'],
  changed: true,
};

describe('schemas', () => {
  it('รับ requirements ที่ครบถ้วน', () => {
    expect(RequirementsSchema.safeParse(validRequirements).success).toBe(true);
  });

  it('ปฏิเสธ requirements ที่ไม่มี acceptanceCriteria', () => {
    const bad = { ...validRequirements, acceptanceCriteria: [] };
    expect(RequirementsSchema.safeParse(bad).success).toBe(false);
  });

  it('task id ต้องเป็น kebab-case', () => {
    expect(TaskSchema.safeParse({ ...validTask, id: 'Bad ID' }).success).toBe(false);
  });

  it('task owner ต้องเป็น frontend หรือ backend', () => {
    expect(TaskSchema.safeParse({ ...validTask, owner: 'qa' }).success).toBe(false);
  });

  it('design ต้องมี task อย่างน้อย 1 รายการ', () => {
    const design = { overview: 'o', architecture: 'a', apiContract: 'n/a', dataModel: 'n/a', tasks: [] };
    expect(DesignSchema.safeParse(design).success).toBe(false);
  });

  it('QAReport verdict ต้องเป็น PASS หรือ FAIL', () => {
    const report = { taskId: 't', verdict: 'MAYBE', checks: [], issues: [], testsAdded: [] };
    expect(QAReportSchema.safeParse(report).success).toBe(false);
  });

  it('toJsonSchema สร้าง JSON Schema draft-07 ที่มี required', () => {
    const js = toJsonSchema(RequirementsSchema);
    expect(String(js.$schema)).toContain('draft-07');
    expect(js.type).toBe('object');
    expect(js.required).toEqual(expect.arrayContaining(['goal', 'features']));
  });

  it('PmTurn: requirements เป็น optional ใน JSON Schema', () => {
    const js = toJsonSchema(PmTurnSchema);
    expect(js.required).toContain('message');
    expect(js.required).not.toContain('requirements');
  });

  it('SecurityReport verdict ต้องเป็น PASS หรือ FAIL', () => {
    const report = { taskId: 't', verdict: 'MAYBE', issues: [] };
    expect(SecurityReportSchema.safeParse(report).success).toBe(false);
  });

  it('SecurityReport รับ issues ที่ครบฟิลด์', () => {
    const report = {
      taskId: 't',
      verdict: 'FAIL',
      issues: [{ severity: 'blocker', file: 'src/x.ts', description: 'มีช่องโหว่', suggestedFix: 'แก้' }],
    };
    expect(SecurityReportSchema.safeParse(report).success).toBe(true);
  });

  it('SecurityReport FAIL ที่ไม่มี issue เลย: ปฏิเสธ (verdict/issues ไม่สอดคล้องกัน)', () => {
    const report = { taskId: 't', verdict: 'FAIL', issues: [] };
    expect(SecurityReportSchema.safeParse(report).success).toBe(false);
  });

  it('SecurityReport FAIL ที่มีแต่ minor issue: ปฏิเสธ (ไม่มีเหตุผลจริงที่จะ FAIL)', () => {
    const report = {
      taskId: 't',
      verdict: 'FAIL',
      issues: [{ severity: 'minor', file: 'x', description: 'สไตล์', suggestedFix: 'ปรับ' }],
    };
    expect(SecurityReportSchema.safeParse(report).success).toBe(false);
  });

  it('SecurityReport FAIL ที่มี major issue: ผ่าน', () => {
    const report = {
      taskId: 't',
      verdict: 'FAIL',
      issues: [{ severity: 'major', file: 'x', description: 'ช่องโหว่', suggestedFix: 'แก้' }],
    };
    expect(SecurityReportSchema.safeParse(report).success).toBe(true);
  });

  it('SecurityReport PASS ที่ไม่มี issue: ยังผ่านตามปกติ (refine ใช้เฉพาะ FAIL)', () => {
    const report = { taskId: 't', verdict: 'PASS', issues: [] };
    expect(SecurityReportSchema.safeParse(report).success).toBe(true);
  });

  it('Design ไม่ต้องมี securityNotes ก็ผ่าน (เผื่อยังไม่ได้รีวิว)', () => {
    const design = { overview: 'o', architecture: 'a', apiContract: 'n/a', dataModel: 'n/a', tasks: [validTask] };
    expect(DesignSchema.safeParse(design).success).toBe(true);
  });

  it('Design รับ securityNotes เมื่อมี', () => {
    const design = {
      overview: 'o',
      architecture: 'a',
      apiContract: 'n/a',
      dataModel: 'n/a',
      tasks: [validTask],
      securityNotes: ['เก็บ password แบบ hash'],
    };
    expect(DesignSchema.safeParse(design).success).toBe(true);
  });
});

describe('length caps (M-4 hardening)', () => {
  it('WorkerResult summary เกิน 4000 ตัวอักษร: ปฏิเสธ', () => {
    const result = {
      taskId: 't',
      summary: 'x'.repeat(4001),
      filesChanged: [],
      howToVerify: '',
    };
    expect(WorkerResultSchema.safeParse(result).success).toBe(false);
  });

  it('WorkerResult summary 4000 ตัวอักษรพอดี: ผ่าน', () => {
    const result = {
      taskId: 't',
      summary: 'x'.repeat(4000),
      filesChanged: [],
      howToVerify: '',
    };
    expect(WorkerResultSchema.safeParse(result).success).toBe(true);
  });

  it('QAIssue description เกิน 2000 ตัวอักษร: ปฏิเสธ', () => {
    const issue = { severity: 'minor', file: 'x', description: 'x'.repeat(2001), suggestedFix: '' };
    expect(QAIssueSchema.safeParse(issue).success).toBe(false);
  });

  it('SecurityDesignReview securityNotes เกิน 50 รายการ: ปฏิเสธ', () => {
    const review = { securityNotes: Array.from({ length: 51 }, (_, i) => `note ${i}`) };
    expect(SecurityDesignReviewSchema.safeParse(review).success).toBe(false);
  });

  it('SecurityDesignReview securityNotes รายการเดียวยาวเกิน 1000 ตัวอักษร: ปฏิเสธ', () => {
    const review = { securityNotes: ['x'.repeat(1001)] };
    expect(SecurityDesignReviewSchema.safeParse(review).success).toBe(false);
  });
});
