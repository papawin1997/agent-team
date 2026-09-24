import { z } from 'zod';

export const RequirementsSchema = z.object({
  goal: z.string().min(1),
  features: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string()),
  outOfScope: z.array(z.string()),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
});
export type Requirements = z.infer<typeof RequirementsSchema>;

export const OwnerSchema = z.enum(['frontend', 'backend']);

export const TaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  owner: OwnerSchema,
  dependsOn: z.array(z.string()),
  description: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  changed: z.boolean(),
});
export type Task = z.infer<typeof TaskSchema>;

export const DesignSchema = z.object({
  overview: z.string().min(1),
  architecture: z.string().min(1),
  apiContract: z.string(),
  dataModel: z.string(),
  tasks: z.array(TaskSchema).min(1),
  securityNotes: z.array(z.string()).optional(),
});
export type Design = z.infer<typeof DesignSchema>;

export const WorkerResultSchema = z.object({
  taskId: z.string().min(1),
  summary: z.string().min(1),
  filesChanged: z.array(z.string()),
  howToVerify: z.string(),
});
export type WorkerResult = z.infer<typeof WorkerResultSchema>;

export const QAIssueSchema = z.object({
  severity: z.enum(['blocker', 'major', 'minor']),
  file: z.string(),
  description: z.string().min(1),
  suggestedFix: z.string(),
});
export type QAIssue = z.infer<typeof QAIssueSchema>;

export const QACheckSchema = z.object({
  name: z.enum(['build', 'lint', 'test', 'review']),
  status: z.enum(['pass', 'fail', 'skipped']),
  output: z.string(),
});

export const QAReportSchema = z.object({
  taskId: z.string().min(1),
  verdict: z.enum(['PASS', 'FAIL']),
  checks: z.array(QACheckSchema),
  issues: z.array(QAIssueSchema),
  testsAdded: z.array(z.string()),
});
export type QAReport = z.infer<typeof QAReportSchema>;

export const SecurityReportSchema = z.object({
  taskId: z.string().min(1),
  verdict: z.enum(['PASS', 'FAIL']),
  issues: z.array(QAIssueSchema),
});
export type SecurityReport = z.infer<typeof SecurityReportSchema>;

export const SecurityDesignReviewSchema = z.object({
  securityNotes: z.array(z.string()),
});
export type SecurityDesignReview = z.infer<typeof SecurityDesignReviewSchema>;

export const PmTurnSchema = z.object({
  message: z.string().min(1),
  status: z.enum(['asking', 'proposal']),
  requirements: RequirementsSchema.optional(),
});
export type PmTurn = z.infer<typeof PmTurnSchema>;

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
}
