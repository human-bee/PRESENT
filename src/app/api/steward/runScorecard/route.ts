import { NextRequest, NextResponse } from 'next/server';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { isFastStewardReady } from '@/lib/agents/fast-steward-config';
import { runDebateScorecardSteward } from '@/lib/agents/debate-judge';
import { runDebateScorecardStewardFast } from '@/lib/agents/subagents/debate-steward-fast';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';
import { createLogger } from '@/lib/logging';
import { parseJsonObject, stewardRunScorecardRequestSchema } from '@/lib/agents/shared/schemas';
import type { JsonObject, JsonValue } from '@/lib/utils/json-schema';
import {
  applyOrchestrationEnvelope,
  deriveDefaultLockKey,
  extractOrchestrationEnvelope,
} from '@/lib/agents/shared/orchestration-envelope';

export const runtime = 'nodejs';

let queue: AgentTaskQueue | null = null;
function getQueue() {
  if (!queue) queue = new AgentTaskQueue();
  return queue;
}
const QUEUE_DIRECT_FALLBACK_ENABLED = process.env.SCORECARD_QUEUE_DIRECT_FALLBACK === 'true';
const logger = createLogger('api:steward:runScorecard');

const compactJsonObject = (input: Record<string, unknown>): JsonObject => {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    output[key] = value as JsonValue;
  }
  return output;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = stewardRunScorecardRequestSchema.parse(body);
    const {
      room,
      componentId,
      windowMs,
      summary,
      prompt,
      intent,
      topic,
      task,
      requestId,
      executionId,
      idempotencyKey,
      lockKey,
      attempt,
      ...rest
    } = parsed;

    const trimmedRoom = room.trim();
    const trimmedComponentId = componentId.trim();

    let billingUserId: string | null = null;
    if (BYOK_ENABLED) {
      const requesterUserId = await resolveRequestUserId(req);
      if (!requesterUserId) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const canvasId = parseCanvasIdFromRoom(trimmedRoom);
      if (!canvasId) {
        return NextResponse.json({ error: 'invalid_room' }, { status: 400 });
      }
      try {
        const membership = await assertCanvasMember({ canvasId, requesterUserId });
        billingUserId = membership.ownerUserId;
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'forbidden') {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        throw error;
      }
    }
    const resolvedWindow =
      windowMs === undefined || windowMs === null ? undefined : Number(windowMs);
    if (resolvedWindow !== undefined && Number.isNaN(resolvedWindow)) {
      return NextResponse.json({ error: 'Invalid windowMs value' }, { status: 400 });
    }

    const normalizedSummary =
      typeof summary === 'string' && summary.trim().length > 0 ? summary.trim().slice(0, 240) : undefined;
    const normalizedPrompt =
      typeof prompt === 'string' && prompt.trim().length > 0 ? prompt.trim() : undefined;
    const normalizedIntent =
      typeof intent === 'string' && intent.trim().length > 0 ? intent.trim() : undefined;
    const normalizedTopic =
      typeof topic === 'string' && topic.trim().length > 0 ? topic.trim() : undefined;
    const normalizedTaskCandidate =
      typeof task === 'string' && task.trim().length > 0
        ? task.trim()
        : normalizedIntent && normalizedIntent.startsWith('scorecard.')
          ? normalizedIntent
          : 'scorecard.run';
    const normalizedTask = normalizedTaskCandidate.startsWith('scorecard.') ? normalizedTaskCandidate : 'scorecard.run';

    logger.debug('POST received', {
      room: trimmedRoom,
      componentId: trimmedComponentId,
      task: normalizedTask,
      windowMs: resolvedWindow,
      summary: normalizedSummary,
      intent: normalizedIntent,
      topic: normalizedTopic,
    });

    const normalizedParams = compactJsonObject({
      ...(parseJsonObject(rest) || {}),
      room: trimmedRoom,
      componentId: trimmedComponentId,
      windowMs: resolvedWindow,
      summary: normalizedSummary,
      prompt: normalizedPrompt,
      intent: normalizedIntent,
      topic: normalizedTopic,
      ...(billingUserId ? { billingUserId } : {}),
    } as const);
    const orchestrationEnvelope = extractOrchestrationEnvelope(
      {
        ...normalizedParams,
        executionId,
        idempotencyKey,
        lockKey,
        attempt,
      },
      { attempt: typeof attempt === 'number' ? attempt : undefined },
    );
    const normalizedLockKey =
      orchestrationEnvelope.lockKey ??
      deriveDefaultLockKey({
        task: normalizedTask,
        room: trimmedRoom,
        componentId: trimmedComponentId,
        componentType: 'DebateScorecard',
      });
    const enrichedParams = applyOrchestrationEnvelope(normalizedParams, {
      ...orchestrationEnvelope,
      lockKey: normalizedLockKey,
    });
    const normalizedRequestId =
      typeof requestId === 'string' && requestId.trim() ? requestId.trim() : orchestrationEnvelope.idempotencyKey;

    try {
      const enqueueResult = await getQueue().enqueueTask({
        room: trimmedRoom,
        task: normalizedTask,
        params: enrichedParams,
        requestId: normalizedRequestId,
        dedupeKey: orchestrationEnvelope.idempotencyKey,
        lockKey: normalizedLockKey,
        idempotencyKey: orchestrationEnvelope.idempotencyKey,
        resourceKeys: [
          `room:${trimmedRoom}`,
          `scorecard:${trimmedComponentId}`,
          ...(normalizedLockKey ? [`lock:${normalizedLockKey}`] : []),
        ],
      });
      return NextResponse.json({ status: 'queued', task: enqueueResult }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('queue enqueue failed', { message });
      if (!QUEUE_DIRECT_FALLBACK_ENABLED) {
        return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 });
      }

      const cerebrasKey =
        BYOK_ENABLED && billingUserId
          ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' })
          : null;
      const useFast = normalizedTask !== 'scorecard.fact_check' && isFastStewardReady(cerebrasKey ?? undefined);
      try {
        if (useFast) {
          await runDebateScorecardStewardFast({
            room: trimmedRoom,
            componentId: trimmedComponentId,
            intent: normalizedIntent ?? normalizedTask,
            summary: normalizedSummary,
            prompt: normalizedPrompt,
            topic: normalizedTopic,
            cerebrasApiKey: cerebrasKey ?? undefined,
          });
        } else {
          await runDebateScorecardSteward({
            room: trimmedRoom,
            componentId: trimmedComponentId,
            windowMs: resolvedWindow,
            intent: normalizedIntent ?? normalizedTask,
            summary: normalizedSummary,
            prompt: normalizedPrompt,
            topic: normalizedTopic,
          });
        }
        return NextResponse.json({ status: 'executed_fallback' }, { status: 202 });
      } catch (fallbackError) {
        logger.error('fallback execution failed', { error: fallbackError });
        return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
      }
    }
  } catch (error) {
    logger.error('invalid request', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
