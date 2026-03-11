import { z } from 'zod';
import { isoDateTimeSchema, jsonObjectSchema } from './core';

const kernelEventBaseSchema = z.object({
  id: z.string().min(1),
  traceId: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  emittedAt: isoDateTimeSchema,
  metadata: jsonObjectSchema.default({}),
});

export const turnLifecycleEventSchema = kernelEventBaseSchema.extend({
  type: z.enum(['turn.started', 'turn.completed', 'turn.failed']),
  taskRunId: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().nullable(),
});

export const toolCallEventSchema = kernelEventBaseSchema.extend({
  type: z.enum(['tool.started', 'tool.completed', 'tool.failed']),
  toolName: z.string().min(1),
  toolCallId: z.string().min(1),
  detail: z.string().nullable(),
});

export const commandEventSchema = kernelEventBaseSchema.extend({
  type: z.enum(['command.started', 'command.output', 'command.completed', 'command.failed']),
  commandId: z.string().min(1),
  command: z.string().min(1),
  output: z.string().nullable(),
});

export const patchEventSchema = kernelEventBaseSchema.extend({
  type: z.enum(['patch.proposed', 'patch.applied', 'patch.reverted']),
  artifactId: z.string().min(1),
  summary: z.string().min(1),
});

export const approvalEventSchema = kernelEventBaseSchema.extend({
  type: z.enum(['approval.requested', 'approval.resolved']),
  approvalRequestId: z.string().min(1),
  state: z.enum(['pending', 'approved', 'rejected', 'expired']),
  summary: z.string().min(1),
});

export const kernelEventSchema = z.discriminatedUnion('type', [
  turnLifecycleEventSchema,
  toolCallEventSchema,
  commandEventSchema,
  patchEventSchema,
  approvalEventSchema,
]);

export type KernelEvent = z.infer<typeof kernelEventSchema>;
