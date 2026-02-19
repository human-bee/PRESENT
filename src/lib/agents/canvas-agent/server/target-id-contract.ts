import type { CanvasFollowupInput } from './followup-queue';

const EXPLICIT_ID_CUE_PATTERN =
  /\b(exact\s+ids?|with\s+id(?:s)?|these\s+ids?|ids?\s+and\s+(?:coordinates|geometry)|ids?\s*:)\b/i;
const EXPLICIT_ID_TOKEN_PATTERN = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/gi;

export const normalizeShapeIdForLookup = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('shape:') ? trimmed.slice('shape:'.length) : trimmed;
};

const normalizeFollowupInput = (
  input: CanvasFollowupInput | null,
  fallbackMessage: string,
  fallbackDepth: number,
): CanvasFollowupInput | null => {
  if (!input) return null;
  const message =
    typeof input.message === 'string' && input.message.trim().length > 0
      ? input.message.trim()
      : fallbackMessage;
  const originalMessage =
    typeof input.originalMessage === 'string' && input.originalMessage.trim().length > 0
      ? input.originalMessage.trim()
      : fallbackMessage;
  const depth = Number.isFinite(input.depth) ? Math.max(0, Math.floor(input.depth)) : fallbackDepth;
  const normalized: CanvasFollowupInput = {
    message,
    originalMessage,
    depth,
  };
  if (typeof input.hint === 'string' && input.hint.trim().length > 0) {
    normalized.hint = input.hint.trim();
  }
  if (typeof input.reason === 'string' && input.reason.trim().length > 0) {
    normalized.reason = input.reason.trim();
  }
  if (input.strict === true) {
    normalized.strict = true;
  }
  if (Array.isArray(input.targetIds)) {
    const targetIds = input.targetIds
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());
    if (targetIds.length > 0) {
      normalized.targetIds = Array.from(new Set(targetIds));
    }
  }
  if (typeof input.enqueuedAt === 'number' && Number.isFinite(input.enqueuedAt)) {
    normalized.enqueuedAt = input.enqueuedAt;
  }
  return normalized;
};

export const inferExplicitTargetIds = (message: string): string[] => {
  if (typeof message !== 'string') return [];
  const trimmed = message.trim();
  if (!trimmed) return [];
  if (!EXPLICIT_ID_CUE_PATTERN.test(trimmed)) return [];

  const seen = new Set<string>();
  const inferred: string[] = [];
  for (const match of trimmed.matchAll(EXPLICIT_ID_TOKEN_PATTERN)) {
    const token = normalizeShapeIdForLookup(match[1]);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    inferred.push(token);
  }
  return inferred;
};

export const mergeFollowupWithInferredTargets = (
  followup: CanvasFollowupInput | null,
  message: string,
  followupDepth: number,
): CanvasFollowupInput | null => {
  const base = normalizeFollowupInput(followup, message, followupDepth);
  const inferredTargetIds = inferExplicitTargetIds(message);
  if (inferredTargetIds.length === 0) return base;

  const explicitTargets = new Map<string, string>();
  if (Array.isArray(base?.targetIds)) {
    for (const id of base.targetIds) {
      const normalized = normalizeShapeIdForLookup(id);
      if (!normalized || explicitTargets.has(normalized)) continue;
      explicitTargets.set(normalized, id.trim());
    }
  }
  for (const inferred of inferredTargetIds) {
    if (!explicitTargets.has(inferred)) {
      explicitTargets.set(inferred, inferred);
    }
  }

  if (base) {
    return {
      ...base,
      strict: true,
      targetIds: Array.from(explicitTargets.values()),
      reason: base.reason ?? 'explicit_target_ids',
    };
  }

  return {
    message,
    originalMessage: message,
    depth: Math.max(0, Math.floor(followupDepth)),
    strict: true,
    targetIds: Array.from(explicitTargets.values()),
    reason: 'explicit_target_ids',
  };
};

export const resolveMissingTargetIds = (
  targetIds: string[] | undefined,
  knownShapeIds: Iterable<string>,
): string[] => {
  if (!Array.isArray(targetIds) || targetIds.length === 0) return [];
  const normalizedKnown = new Set<string>();
  for (const shapeId of knownShapeIds) {
    const normalized = normalizeShapeIdForLookup(shapeId);
    if (normalized) normalizedKnown.add(normalized);
  }

  const normalizedTargets = new Map<string, string>();
  for (const targetId of targetIds) {
    if (typeof targetId !== 'string') continue;
    const trimmed = targetId.trim();
    const normalized = normalizeShapeIdForLookup(trimmed);
    if (!trimmed || !normalized || normalizedTargets.has(normalized)) continue;
    normalizedTargets.set(normalized, trimmed);
  }

  const missing: string[] = [];
  for (const [normalized, original] of normalizedTargets.entries()) {
    if (!normalizedKnown.has(normalized)) {
      missing.push(original);
    }
  }
  return missing;
};
