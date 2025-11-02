import { createHash } from 'crypto';

const VOLATILE_KEYS = new Set(['updatedAt', 'timestamp', 'ts']);

type JsonLike = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

function normalizeValue(value: unknown): JsonLike {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item))
      .filter((item) => item !== null) as Array<JsonLike>;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, v]) => !VOLATILE_KEYS.has(key) && v !== undefined)
      .map(([key, v]) => [key, normalizeValue(v)] as const)
      .filter(([, v]) => v !== null);

    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return entries.reduce<Record<string, JsonLike>>((acc, [key, v]) => {
      acc[key] = v;
      return acc;
    }, {});
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Number.isInteger(value) ? Math.trunc(value) : Number(value.toFixed(6));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return null;
}

function hashToId(prefix: string, payload: string): string {
  const digest = createHash('sha256').update(payload).digest('base64url').slice(0, 24);
  return `${prefix}-${digest}`;
}

export function canonicalizeComponentSpec(spec: Record<string, unknown> | undefined): string {
  const normalized = normalizeValue(spec || {});
  return JSON.stringify(normalized ?? {});
}

export interface ComponentIntentInput {
  roomName?: string;
  turnId: number;
  componentType: string;
  spec: Record<string, unknown> | undefined;
  slot?: string;
}

export interface ComponentIntent {
  intentId: string;
  messageId: string;
  canonicalSpec: string;
}

export function deriveComponentIntent({
  roomName,
  turnId,
  componentType,
  spec,
  slot,
}: ComponentIntentInput): ComponentIntent {
  const canonicalSpec = canonicalizeComponentSpec(spec);
  const basePayload = JSON.stringify({
    v: 1,
    room: roomName || 'roomless',
    turn: turnId,
    type: componentType,
    slot: slot || null,
    spec: canonicalSpec,
  });
  const intentId = hashToId('intent', basePayload);
  const messagePayload = JSON.stringify({ v: 1, intentId, type: componentType });
  const messageId = hashToId('ui', messagePayload);
  return { intentId, messageId, canonicalSpec };
}
