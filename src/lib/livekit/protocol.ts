import { z } from 'zod';
import { jsonObjectSchema } from '@/lib/utils/json-schema';

const BaseMessageSchema = z
  .object({
    id: z.string().min(1).optional(),
    roomId: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    timestamp: z.number().int().optional(),
  })
  .passthrough();

export const ToolCallPayloadSchema = z
  .object({
    tool: z.string().min(1),
    params: jsonObjectSchema.optional(),
    context: jsonObjectSchema.optional(),
  })
  .passthrough();

export const ToolCallMessageSchema = BaseMessageSchema.extend({
  type: z.literal('tool_call'),
  payload: ToolCallPayloadSchema,
});

export const ToolResultMessageSchema = BaseMessageSchema.extend({
  type: z.literal('tool_result'),
  payload: z
    .object({
      tool: z.string().min(1).optional(),
      status: z.string().optional(),
      result: z.unknown().optional(),
      error: z.unknown().optional(),
    })
    .passthrough(),
});

export const DecisionMessageSchema = BaseMessageSchema.extend({
  type: z.literal('decision'),
  payload: z
    .object({
      decision: z
        .object({
          should_send: z.boolean().optional(),
          summary: z.string().optional(),
        })
        .passthrough()
        .optional(),
      originalText: z.string().optional(),
    })
    .passthrough(),
});

export const StewardTriggerMessageSchema = BaseMessageSchema.extend({
  type: z.literal('steward_trigger'),
  payload: z
    .object({
      kind: z.enum(['flowchart', 'canvas']),
      room: z.string().optional(),
      docId: z.string().optional(),
      summary: z.string().optional(),
      mode: z.enum(['auto', 'fast', 'slow']).optional(),
      reason: z.string().optional(),
    })
    .passthrough(),
});

export const DispatcherMessageSchema = z.union([
  ToolCallMessageSchema,
  ToolResultMessageSchema,
  DecisionMessageSchema,
  StewardTriggerMessageSchema,
]);

export type ToolCallMessage = z.infer<typeof ToolCallMessageSchema>;
export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;
export type DecisionMessage = z.infer<typeof DecisionMessageSchema>;
export type StewardTriggerMessage = z.infer<typeof StewardTriggerMessageSchema>;
export type DispatcherMessage = z.infer<typeof DispatcherMessageSchema>;

export const parseToolCallMessage = (input: unknown): ToolCallMessage | null => {
  const parsed = ToolCallMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

export const parseStewardTriggerMessage = (input: unknown): StewardTriggerMessage | null => {
  const parsed = StewardTriggerMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

export const parseDecisionMessage = (input: unknown): DecisionMessage | null => {
  const parsed = DecisionMessageSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};
