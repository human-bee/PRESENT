import { z } from 'zod';

export const projectIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);

/** Public registry facts deliberately omit every local filesystem location. */
export const projectSummarySchema = z.object({
  id: projectIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(300).default(''),
}).strict();
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

/** Immutable source selection retained with the job, not accepted from the browser. */
export const projectSnapshotSchema = projectSummarySchema.extend({
  sourceFingerprint: sha256,
  commit,
  snapshotId: sha256,
  files: z.number().int().min(0).max(100),
  bytes: z.number().int().min(0).max(8 * 1024 * 1024),
}).strict();
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>;

export const projectChangeSchema = z.object({
  path: z.string().min(1).max(240),
  status: z.enum(['A', 'M', 'D']),
}).strict();
export const projectExecutionSchema = z.object({
  project: projectSnapshotSchema,
  changes: z.array(projectChangeSchema).max(100),
  diff: z.string().max(48000),
  diffTruncated: z.boolean(),
}).strict();
export type ProjectExecution = z.infer<typeof projectExecutionSchema>;
