import { describe, expect, it } from 'vitest';
import {
  DesignSchema,
  PmTurnSchema,
  QAReportSchema,
  RequirementsSchema,
  TaskSchema,
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
});
