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
    taskId: z.string().optional(),
    attempt: z.number().int().min(0).optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    authRailHint: z.string().optional(),
    experiment_id: z.string().optional(),
    variant_id: z.string().optional(),
    assignment_namespace: z.string().optional(),
    assignment_unit: z.string().optional(),
    assignment_ts: z.string().optional(),
    factor_levels: z.record(z.string(), z.string()).optional(),
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

const sanitizeUnknown = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    const next = value
      .map((entry) => sanitizeUnknown(entry))
      .filter((entry) => entry !== undefined);
    return next;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      const sanitized = sanitizeUnknown(entry);
      if (sanitized !== undefined) {
        next[key] = sanitized;
      }
    }
    return next;
  }
  return value;
};

export const stripUndefinedDeep = <T>(value: T): T => {
  if (value === undefined) {
    return value;
  }
  return sanitizeUnknown(value) as T;
};

export const isZodSchemaLike = (value: unknown): value is z.ZodTypeAny => {
  if (!value || typeof value !== 'object') return false;
  try {
    const candidate = value as Partial<z.ZodTypeAny>;
    return typeof candidate.parse === 'function' && typeof candidate.safeParse === 'function';
  } catch {
    return false;
  }
};
