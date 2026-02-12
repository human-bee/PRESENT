import type { JsonObject } from '@/lib/utils/json-schema';

export type OrchestrationEnvelope = {
  executionId?: string;
  idempotencyKey?: string;
  lockKey?: string;
  attempt?: number;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeAttempt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const extractOrchestrationEnvelope = (
  value: unknown,
  defaults: OrchestrationEnvelope = {},
): OrchestrationEnvelope => {
  const source = isRecord(value) ? value : {};
  const executionId = normalizeString(source.executionId) ?? defaults.executionId;
  const idempotencyKey = normalizeString(source.idempotencyKey) ?? defaults.idempotencyKey;
  const lockKey = normalizeString(source.lockKey) ?? defaults.lockKey;
  const attempt = normalizeAttempt(source.attempt) ?? defaults.attempt;

  return {
    ...(executionId ? { executionId } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(lockKey ? { lockKey } : {}),
    ...(typeof attempt === 'number' ? { attempt } : {}),
  };
};

export const applyOrchestrationEnvelope = (
  target: JsonObject,
  envelope: OrchestrationEnvelope,
): JsonObject => {
  const next: JsonObject = { ...target };
  if (envelope.executionId) next.executionId = envelope.executionId;
  if (envelope.idempotencyKey) next.idempotencyKey = envelope.idempotencyKey;
  if (envelope.lockKey) next.lockKey = envelope.lockKey;
  if (typeof envelope.attempt === 'number') next.attempt = envelope.attempt;
  return next;
};

export const deriveDefaultLockKey = (input: {
  task?: string;
  room?: string;
  componentId?: string;
  componentType?: string;
  explicitLockKey?: string;
}): string | undefined => {
  const explicit = normalizeString(input.explicitLockKey);
  if (explicit) return explicit;

  const componentId = normalizeString(input.componentId);
  if (componentId) return `widget:${componentId}`;

  const componentType = normalizeString(input.componentType);
  if (componentType) return `widget-type:${componentType}`;

  const task = normalizeString(input.task);
  const room = normalizeString(input.room);
  if (!task) return undefined;
  if (task.startsWith('canvas.') || task.startsWith('fairy.')) {
    return room ? `room:${room}:canvas` : 'canvas:global';
  }
  if (task.startsWith('search.')) {
    return room ? `room:${room}:search` : 'search:global';
  }
  if (task.startsWith('scorecard.')) {
    return room ? `room:${room}:scorecard` : 'scorecard:global';
  }

  return room ? `room:${room}:${task}` : undefined;
};

