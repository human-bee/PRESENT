import { z } from 'zod';
import { jsonObjectSchema, jsonValueSchema } from '@/lib/utils/json-schema';

export const JsonValueSchema = jsonValueSchema;
export const JsonObjectSchema = jsonObjectSchema;

export const queueTaskParamsSchema = JsonObjectSchema.default({});
export const orchestrationEnvelopeSchema = z.object({
  executionId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  lockKey: z.string().min(1).optional(),
  attempt: z.number().int().min(0).optional(),
});

export const queueTaskEnvelopeSchema = z.object({
  room: z.string().min(1),
  task: z.string().min(1),
  params: queueTaskParamsSchema,
  requestId: z.string().min(1).optional(),
  dedupeKey: z.string().min(1).optional(),
  resourceKeys: z.array(z.string().min(1)).optional(),
  priority: z.number().int().min(0).default(0),
  runAt: z.coerce.date().optional(),
}).merge(orchestrationEnvelopeSchema.partial());

export const stewardRunCanvasRequestSchema = z
  .object({
    room: z.string().min(1),
    task: z.string().min(1).optional(),
    params: JsonObjectSchema.optional(),
    summary: z.string().optional(),
    message: z.string().optional(),
    requestId: z.string().optional(),
    traceId: z.string().optional(),
    intentId: z.string().optional(),
  })
  .merge(orchestrationEnvelopeSchema.partial())
  .passthrough();

export const stewardRunScorecardRequestSchema = z
  .object({
    room: z.string().min(1),
    componentId: z.string().min(1),
    windowMs: z.number().int().min(1_000).max(600_000).optional(),
    summary: z.string().optional(),
    prompt: z.string().optional(),
    intent: z.string().optional(),
    topic: z.string().optional(),
    task: z.string().optional(),
    requestId: z.string().optional(),
  })
  .merge(orchestrationEnvelopeSchema.partial())
  .passthrough();

export const isJsonObject = (value: unknown): value is z.infer<typeof JsonObjectSchema> => {
  return JsonObjectSchema.safeParse(value).success;
};

export const parseJsonObject = (value: unknown): z.infer<typeof JsonObjectSchema> | null => {
  const parsed = JsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const parseJsonValue = (value: unknown): z.infer<typeof JsonValueSchema> | null => {
  const parsed = JsonValueSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
