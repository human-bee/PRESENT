import { createHash } from 'crypto';
import type { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { normalizeCorrelationId, type RequestCorrelation } from '@/lib/agents/shared/request-correlation';
import type { JsonObject } from '@/lib/utils/json-schema';
import {
  getRuntimeScopeResourceKey,
  normalizeRuntimeScope,
  resolveRuntimeScopeFromEnv,
} from '@/lib/agents/shared/runtime-scope';

export type CanvasFollowupInput = {
  message: string;
  originalMessage: string;
  depth: number;
  hint?: string;
  targetIds?: string[];
  strict?: boolean;
  reason?: string;
  enqueuedAt?: number;
};

export type FollowupQueueOptions = {
  queue: Pick<AgentTaskQueue, 'enqueueTask'>;
  roomId: string;
  sessionId: string;
  correlation?: RequestCorrelation;
  metadata?: JsonObject | null;
  initialViewport?: { x: number; y: number; w: number; h: number };
  taskName?: string;
};

type NormalizedFollowup = {
  message: string;
  originalMessage: string;
  depth: number;
  hint?: string;
  targetIds: string[];
  strict: boolean;
  reason?: string;
  enqueuedAt: number;
};

const FOLLOWUP_TASK_NAME = 'canvas.followup';

const toNormalizedFollowup = (input: CanvasFollowupInput): NormalizedFollowup | null => {
  const message = input.message.trim();
  const originalMessage = input.originalMessage.trim();
  if (!message || !originalMessage) return null;
  const depth = Number.isFinite(input.depth) ? Math.max(0, Math.floor(input.depth)) : 0;
  const targetIds = Array.isArray(input.targetIds)
    ? Array.from(
        new Set(
          input.targetIds
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ).sort()
    : [];
  const hint = typeof input.hint === 'string' ? input.hint.trim() : '';
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const enqueuedAt = Number.isFinite(input.enqueuedAt) ? Number(input.enqueuedAt) : Date.now();

  return {
    message,
    originalMessage,
    depth,
    ...(hint ? { hint } : {}),
    targetIds,
    strict: input.strict === true,
    ...(reason ? { reason } : {}),
    enqueuedAt,
  };
};

export const buildFollowupFingerprint = (
  roomId: string,
  correlation: RequestCorrelation | undefined,
  input: CanvasFollowupInput,
): string | null => {
  const normalized = toNormalizedFollowup(input);
  if (!normalized) return null;
  const traceOrIntent = correlation?.traceId || correlation?.intentId || '';
  return [
    roomId,
    traceOrIntent,
    normalized.depth,
    normalized.message,
    normalized.originalMessage,
    normalized.hint ?? '',
    normalized.reason ?? '',
    normalized.targetIds.join(','),
    normalized.strict ? 'strict' : 'flex',
  ].join('|');
};

const hashFingerprint = (fingerprint: string): string => {
  return createHash('sha1').update(fingerprint).digest('hex').slice(0, 20);
};

export const buildFollowupRequestId = (
  roomId: string,
  correlation: RequestCorrelation | undefined,
  input: CanvasFollowupInput,
): string | null => {
  const fingerprint = buildFollowupFingerprint(roomId, correlation, input);
  if (!fingerprint) return null;
  const digest = hashFingerprint(fingerprint).slice(0, 10);
  const normalized = toNormalizedFollowup(input);
  if (!normalized) return null;

  const prefixSource =
    correlation?.requestId || correlation?.traceId || correlation?.intentId || `canvas-followup:${roomId}`;
  const prefix = normalizeCorrelationId(prefixSource) || `canvas-followup:${roomId}`;
  return normalizeCorrelationId(`${prefix}:d${normalized.depth}:${digest}`) || `${prefix.slice(0, 120)}:${digest}`;
};

const buildFollowupPayload = (
  options: FollowupQueueOptions,
  normalized: NormalizedFollowup,
  requestId: string,
): JsonObject => {
  const payload: JsonObject = {
    room: options.roomId,
    message: normalized.message,
    requestId,
    depth: normalized.depth,
    followup: {
      depth: normalized.depth,
      parentSessionId: options.sessionId,
      parentRequestId: options.correlation?.requestId ?? null,
      originalMessage: normalized.originalMessage,
      hint: normalized.hint ?? null,
      targetIds: normalized.targetIds,
      strict: normalized.strict,
      reason: normalized.reason ?? null,
      enqueuedAt: normalized.enqueuedAt,
    },
  };

  if (normalized.targetIds.length > 0) {
    payload.selectionIds = normalized.targetIds;
  }
  if (options.correlation?.traceId) {
    payload.traceId = options.correlation.traceId;
  }
  if (options.correlation?.intentId) {
    payload.intentId = options.correlation.intentId;
  }
  if (options.initialViewport) {
    payload.bounds = options.initialViewport;
  }

  const metadata =
    options.metadata && typeof options.metadata === 'object' && !Array.isArray(options.metadata)
      ? { ...options.metadata }
      : {};
  const followupMeta = {
    depth: normalized.depth,
    parentSessionId: options.sessionId,
    parentRequestId: options.correlation?.requestId ?? null,
    reason: normalized.reason ?? 'model_followup',
  };
  metadata.followup = followupMeta;
  if (options.correlation?.traceId && !metadata.traceId) {
    metadata.traceId = options.correlation.traceId;
  }
  if (options.correlation?.intentId && !metadata.intentId) {
    metadata.intentId = options.correlation.intentId;
  }
  const runtimeScope =
    normalizeRuntimeScope(metadata.runtimeScope) ??
    normalizeRuntimeScope((payload as Record<string, unknown>).runtimeScope) ??
    resolveRuntimeScopeFromEnv();
  if (runtimeScope) {
    payload.runtimeScope = runtimeScope;
    if (!metadata.runtimeScope) {
      metadata.runtimeScope = runtimeScope;
    }
  }
  payload.metadata = metadata;

  return payload;
};

export async function enqueueCanvasFollowup(
  options: FollowupQueueOptions,
  input: CanvasFollowupInput,
): Promise<boolean> {
  const normalized = toNormalizedFollowup(input);
  if (!normalized) return false;

  const fingerprint = buildFollowupFingerprint(options.roomId, options.correlation, normalized);
  if (!fingerprint) return false;
  const requestId = buildFollowupRequestId(options.roomId, options.correlation, normalized);
  if (!requestId) return false;

  const payload = buildFollowupPayload(options, normalized, requestId);
  const dedupeKey = hashFingerprint(fingerprint);
  const followupScopeKey =
    options.correlation?.intentId
      ? `intent:${options.correlation.intentId}`
      : options.correlation?.traceId
        ? `trace:${options.correlation.traceId}`
        : options.correlation?.requestId
          ? `request:${options.correlation.requestId}`
          : 'followup:unscoped';
  const resourceKeys = [
    `room:${options.roomId}`,
    'canvas:followup',
    followupScopeKey,
    `followup-depth:${normalized.depth}`,
  ];
  const runtimeScopeKey = getRuntimeScopeResourceKey(
    typeof payload.runtimeScope === 'string' ? payload.runtimeScope : undefined,
  );
  if (runtimeScopeKey) {
    resourceKeys.push(runtimeScopeKey);
  }

  const task = await options.queue.enqueueTask({
    room: options.roomId,
    task: options.taskName ?? FOLLOWUP_TASK_NAME,
    params: payload,
    requestId,
    dedupeKey,
    resourceKeys,
  });

  return Boolean(task);
}
