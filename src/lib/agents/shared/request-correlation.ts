import type { JsonObject } from '@/lib/utils/json-schema';

const MAX_CORRELATION_ID_LENGTH = 160;

export type RequestCorrelation = {
  requestId?: string;
  traceId?: string;
  intentId?: string;
};

export const normalizeCorrelationId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= MAX_CORRELATION_ID_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_CORRELATION_ID_LENGTH);
};

const firstDefinedCorrelationId = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const normalized = normalizeCorrelationId(value);
    if (normalized) return normalized;
  }
  return undefined;
};

const readMetadata = (params: JsonObject): Record<string, unknown> | null => {
  const metadata = params.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
};

const readTraceMetadata = (metadata: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (!metadata) return null;
  const trace = metadata._trace;
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return null;
  return trace as Record<string, unknown>;
};

export function deriveRequestCorrelation(args: {
  task?: string;
  requestId?: unknown;
  params?: JsonObject | null;
}): RequestCorrelation {
  const params = (args.params ?? {}) as JsonObject;
  const metadata = readMetadata(params);
  const traceMetadata = readTraceMetadata(metadata);
  const normalizedTask = normalizeCorrelationId(args.task) ?? '';

  const requestId = firstDefinedCorrelationId(
    args.requestId,
    (params as any).requestId,
    (params as any).id,
    (params as any).intentId,
    (params as any).executionId,
    (params as any).idempotencyKey,
  );

  const intentId = firstDefinedCorrelationId(
    (params as any).intentId,
    (params as any).intent,
    normalizedTask === 'fairy.intent' ? (params as any).id : undefined,
    metadata?.intentId,
    metadata?.intent_id,
    traceMetadata?.intentId,
    requestId,
  );

  const traceId = firstDefinedCorrelationId(
    (params as any).traceId,
    metadata?.traceId,
    metadata?.trace_id,
    traceMetadata?.traceId,
    traceMetadata?.id,
    requestId,
  );

  return { requestId, traceId, intentId };
}
