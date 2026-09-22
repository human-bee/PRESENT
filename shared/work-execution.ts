import { z } from 'zod';

const commandReceiptSchema = z.object({
  id: z.string().min(1).max(100), command: z.string().max(300), truncated: z.boolean().optional(), commandSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  status: z.enum(['completed', 'failed', 'declined']), exitCode: z.number().int().nullable(),
}).strict();
const workspaceFileSchema = z.object({
  path: z.string().min(1).max(240), bytes: z.number().int().min(0), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** Public facts are collected from provider execution events and actual regular files. */
export const workExecutionSchema = z.object({
  boundary: z.literal('local-workspace'), continued: z.boolean(),
  commands: z.array(commandReceiptSchema).max(12), files: z.array(workspaceFileSchema).max(100),
}).strict();
export type WorkExecution = z.infer<typeof workExecutionSchema>;
export type WorkCommandReceipt = z.infer<typeof commandReceiptSchema>;

/** Kept only in server metadata; never accepted from a shared canvas card or API request. */
export const workExecutionStateSchema = z.object({
  workspaceId: z.string().regex(/^[a-f0-9]{32}$/), threadId: z.string().min(1).max(100).nullable(),
  turnId: z.string().min(1).max(100).nullable(), dispatchId: z.string().max(150).nullable(),
  phase: z.enum(['ready', 'dispatching', 'running', 'completed', 'interrupted', 'failed']),
  commands: z.array(commandReceiptSchema).max(12), output: z.string().max(24000).optional(),
}).strict();
export type WorkExecutionState = z.infer<typeof workExecutionStateSchema>;
