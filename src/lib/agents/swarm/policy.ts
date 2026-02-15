import { flags } from '@/lib/feature-flags';
import { FairyBoundsSchema, normalizeFairyIntent, routeFairyIntent } from '@/lib/fairy-intent';
import type { JsonObject } from '@/lib/utils/json-schema';
import type { SwarmDecision } from './types';

const clampConfidence = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

const decisionFromFairyKind = (kind: string, confidence: number): SwarmDecision => {
  if (kind === 'canvas') {
    return { kind: 'canvas', task: 'canvas.agent_prompt', confidence, reason: 'fairy:canvas' };
  }
  if (kind === 'scorecard') {
    return { kind: 'scorecard', task: 'scorecard.run', confidence, reason: 'fairy:scorecard' };
  }
  if (kind === 'crowd_pulse') {
    return { kind: 'crowd_pulse', task: 'fairy.intent', confidence, reason: 'fairy:crowd_pulse' };
  }
  if (kind === 'summary') {
    return { kind: 'summary', task: 'fairy.intent', confidence, reason: 'fairy:summary' };
  }
  if (kind === 'infographic' || kind === 'kanban' || kind === 'bundle' || kind === 'view') {
    return { kind: 'direct', task: 'fairy.intent', confidence, reason: `fairy:${kind}` };
  }
  return { kind: 'direct', task: 'fairy.intent', confidence, reason: 'fairy:default' };
};

export async function buildSwarmDecision(taskName: string, params: JsonObject): Promise<SwarmDecision> {
  if (taskName && taskName !== 'auto' && taskName !== 'conductor.dispatch' && taskName !== 'fairy.intent') {
    return {
      kind: 'direct',
      task: taskName,
      confidence: 1,
      reason: 'explicit_task',
    };
  }

  const parsedBounds = FairyBoundsSchema.safeParse(params.bounds);
  const room = typeof params.room === 'string' && params.room.trim().length > 0 ? params.room.trim() : 'unknown-room';
  const message =
    typeof params.message === 'string' && params.message.trim().length > 0
      ? params.message
      : typeof params.transcript === 'string' && params.transcript.trim().length > 0
        ? params.transcript
        : 'Please assist on the canvas';
  const normalizedIntent = normalizeFairyIntent({
    id:
      (typeof params.id === 'string' && params.id.trim()) ||
      (typeof params.requestId === 'string' && params.requestId.trim()) ||
      `swarm-${Date.now().toString(36)}`,
    room,
    message,
    source: 'system',
    timestamp: Date.now(),
    selectionIds: Array.isArray(params.selectionIds) ? (params.selectionIds as string[]) : undefined,
    bounds: parsedBounds.success ? parsedBounds.data : undefined,
    metadata:
      params.metadata && typeof params.metadata === 'object' && !Array.isArray(params.metadata)
        ? (params.metadata as JsonObject)
        : undefined,
  });
  const fairyDecision = await routeFairyIntent(normalizedIntent);
  const primary = decisionFromFairyKind(fairyDecision.kind, clampConfidence(fairyDecision.confidence ?? 0.5));

  if (!flags.swarmFairySpeculativeEnabled) return primary;
  if (primary.confidence >= flags.swarmFairyConfidenceThreshold) return primary;

  const hasSearchHint = /\b(search|research|sources|citation|verify)\b/i.test(message);
  if (hasSearchHint) {
    return {
      kind: 'search',
      task: 'search.bundle',
      confidence: Math.max(primary.confidence, 0.66),
      reason: 'speculative_search_hint',
    };
  }

  return primary;
}
