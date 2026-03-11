import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { BYOK_ENABLED, DEV_BYPASS_ENABLED } from '@/lib/agents/shared/byok-flags';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { createLogger } from '@/lib/logging';
import { parseJsonObject, stewardRunTimelineRequestSchema } from '@/lib/agents/shared/schemas';
import type { JsonObject, JsonValue } from '@/lib/utils/json-schema';
import {
  applyOrchestrationEnvelope,
  deriveDefaultLockKey,
  extractOrchestrationEnvelope,
} from '@/lib/agents/shared/orchestration-envelope';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { deriveRequestCorrelation } from '@/lib/agents/shared/request-correlation';
import {
  getRuntimeScopeResourceKey,
  normalizeRuntimeScope,
  resolveRuntimeScopeFromEnv,
} from '@/lib/agents/shared/runtime-scope';
import { commitTimelineDocument, getTimelineDocument } from '@/lib/agents/shared/supabase-context';
import { runTimelineStewardFast } from '@/lib/agents/subagents/timeline-steward-fast';
import { timelineSourceEnum, type TimelineOp } from '@/lib/agents/timeline-schema';

export const runtime = 'nodejs';

let queue: AgentTaskQueue | null = null;
function getQueue() {
  if (!queue) queue = new AgentTaskQueue();
  return queue;
}
const QUEUE_DIRECT_FALLBACK_ENABLED = process.env.TIMELINE_QUEUE_DIRECT_FALLBACK === 'true';
const logger = createLogger('api:steward:runTimeline');

const compactJsonObject = (input: Record<string, unknown>): JsonObject => {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    output[key] = value as JsonValue;
  }
  return output;
};

const parseSource = (value: unknown) =>
  timelineSourceEnum.safeParse(value).success ? timelineSourceEnum.parse(value) : undefined;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = stewardRunTimelineRequestSchema.parse(body);
    const {
      room,
      componentId,
      task,
      instruction,
      prompt,
      summary,
      source,
      title,
      subtitle,
      horizonLabel,
      ops,
      requestId,
      traceId,
      intentId,
      executionId,
      idempotencyKey,
      lockKey,
      attempt,
      ...rest
    } = parsed;

    const trimmedRoom = room.trim();
    const trimmedComponentId = componentId.trim();
    const devBypassEnabled = DEV_BYPASS_ENABLED && process.env.NODE_ENV !== 'production';
    const requesterUserId = await resolveRequestUserId(req);
    if (!requesterUserId && !devBypassEnabled) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const canvasId = parseCanvasIdFromRoom(trimmedRoom);
    if (!canvasId) {
      return NextResponse.json({ error: 'invalid_room' }, { status: 400 });
    }

    let membershipOwnerUserId: string | null = null;
    if (!devBypassEnabled) {
      try {
        const membership = await assertCanvasMember({
          canvasId,
          requesterUserId: requesterUserId!,
        });
        membershipOwnerUserId = membership.ownerUserId;
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'forbidden') {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        throw error;
      }
    }

    let billingUserId: string | null = null;
    if (BYOK_ENABLED) {
      billingUserId = membershipOwnerUserId;
    }

    const normalizedInstruction =
      typeof instruction === 'string' && instruction.trim().length > 0
        ? instruction.trim()
        : typeof prompt === 'string' && prompt.trim().length > 0
          ? prompt.trim()
          : undefined;
    const normalizedSummary =
      typeof summary === 'string' && summary.trim().length > 0 ? summary.trim().slice(0, 240) : undefined;
    const normalizedSource = parseSource(source) ?? (Array.isArray(ops) && ops.length > 0 ? 'tool' : 'manual');
    const normalizedTaskCandidate =
      typeof task === 'string' && task.trim().length > 0
        ? task.trim()
        : Array.isArray(ops) && ops.length > 0
          ? 'timeline.patch'
          : 'timeline.run';
    const normalizedTask = normalizedTaskCandidate.startsWith('timeline.')
      ? normalizedTaskCandidate
      : Array.isArray(ops) && ops.length > 0
        ? 'timeline.patch'
        : 'timeline.run';

    const passthrough = (parseJsonObject(rest) || {}) as Record<string, unknown>;
    delete passthrough.billingUserId;
    delete passthrough.requesterUserId;
    const normalizedParams = compactJsonObject({
      ...passthrough,
      room: trimmedRoom,
      componentId: trimmedComponentId,
      task: normalizedTask,
      instruction: normalizedInstruction,
      prompt: normalizedInstruction,
      summary: normalizedSummary,
      source: normalizedSource,
      title: typeof title === 'string' && title.trim().length > 0 ? title.trim() : undefined,
      subtitle: typeof subtitle === 'string' && subtitle.trim().length > 0 ? subtitle.trim() : undefined,
      horizonLabel:
        typeof horizonLabel === 'string' && horizonLabel.trim().length > 0 ? horizonLabel.trim() : undefined,
      ops: Array.isArray(ops) ? (ops as unknown as JsonValue) : undefined,
      ...(requesterUserId ? { requesterUserId } : {}),
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
        componentType: 'McpAppWidget',
      });
    const enrichedParams = applyOrchestrationEnvelope(normalizedParams, {
      ...orchestrationEnvelope,
      lockKey: normalizedLockKey,
    });

    const correlation = deriveRequestCorrelation({
      task: normalizedTask,
      requestId:
        (typeof requestId === 'string' && requestId.trim()) ||
        orchestrationEnvelope.idempotencyKey ||
        intentId ||
        (typeof enrichedParams.requestId === 'string' ? enrichedParams.requestId : undefined),
      params: enrichedParams,
    });
    const canonicalRequestId =
      correlation.requestId ||
      (typeof requestId === 'string' && requestId.trim().length > 0 ? requestId.trim() : undefined) ||
      `req-${randomUUID()}`;
    const canonicalTraceId =
      (typeof traceId === 'string' && traceId.trim().length > 0 ? traceId.trim() : undefined) ||
      correlation.traceId ||
      canonicalRequestId;
    const canonicalIntentId =
      (typeof intentId === 'string' && intentId.trim().length > 0 ? intentId.trim() : undefined) ||
      correlation.intentId ||
      canonicalRequestId;
    const effectiveIdempotencyKey =
      (typeof orchestrationEnvelope.idempotencyKey === 'string' && orchestrationEnvelope.idempotencyKey.trim().length > 0
        ? orchestrationEnvelope.idempotencyKey.trim()
        : canonicalRequestId);
    enrichedParams.requestId = canonicalRequestId;
    enrichedParams.traceId = canonicalTraceId;
    enrichedParams.intentId = canonicalIntentId;
    enrichedParams.idempotencyKey = effectiveIdempotencyKey;

    const runtimeScope = normalizeRuntimeScope(enrichedParams.runtimeScope) ?? resolveRuntimeScopeFromEnv();
    if (runtimeScope) {
      enrichedParams.runtimeScope = runtimeScope;
      const metadata =
        enrichedParams.metadata && typeof enrichedParams.metadata === 'object' && !Array.isArray(enrichedParams.metadata)
          ? ({ ...(enrichedParams.metadata as JsonObject) } as JsonObject)
          : ({} as JsonObject);
      if (!metadata.runtimeScope) {
        metadata.runtimeScope = runtimeScope;
      }
      enrichedParams.metadata = metadata;
    }

    try {
      const runtimeScopeKey = getRuntimeScopeResourceKey(
        typeof enrichedParams.runtimeScope === 'string' ? enrichedParams.runtimeScope : undefined,
      );
      const enqueueResult = await getQueue().enqueueTask({
        room: trimmedRoom,
        task: normalizedTask,
        params: enrichedParams,
        requestId: canonicalRequestId,
        dedupeKey: effectiveIdempotencyKey,
        lockKey: normalizedLockKey,
        idempotencyKey: effectiveIdempotencyKey,
        resourceKeys: [
          `room:${trimmedRoom}`,
          `timeline:${trimmedComponentId}`,
          ...(runtimeScopeKey ? [runtimeScopeKey] : []),
          ...(normalizedLockKey ? [`lock:${normalizedLockKey}`] : []),
        ],
      });
      return NextResponse.json(
        {
          status: 'queued',
          task: enqueueResult,
          taskId: enqueueResult?.id ?? null,
          requestId: canonicalRequestId,
          traceId: canonicalTraceId,
          intentId: canonicalIntentId,
        },
        { status: 202 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('queue enqueue failed', { message });
      if (!QUEUE_DIRECT_FALLBACK_ENABLED) {
        return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 });
      }

      try {
        if (normalizedTask === 'timeline.patch' && Array.isArray(ops) && ops.length > 0) {
          await commitTimelineDocument(trimmedRoom, trimmedComponentId, {
            ops: ops as TimelineOp[],
            componentType: 'McpAppWidget',
          });
        } else {
          const current = await getTimelineDocument(trimmedRoom, trimmedComponentId);
          const result = await runTimelineStewardFast({
            room: trimmedRoom,
            componentId: trimmedComponentId,
            instruction: normalizedInstruction,
            source: normalizedSource,
            document: current.document,
            title: typeof enrichedParams.title === 'string' ? enrichedParams.title : undefined,
            subtitle: typeof enrichedParams.subtitle === 'string' ? enrichedParams.subtitle : undefined,
            horizonLabel:
              typeof enrichedParams.horizonLabel === 'string' ? enrichedParams.horizonLabel : undefined,
            requestId: canonicalRequestId,
            traceId: canonicalTraceId,
            intentId: canonicalIntentId,
            idempotencyKey: effectiveIdempotencyKey,
          });
          await commitTimelineDocument(trimmedRoom, trimmedComponentId, {
            ops: result.ops,
            prevVersion: current.version,
            componentType: 'McpAppWidget',
          });
        }
        return NextResponse.json(
          {
            status: 'executed_fallback',
            requestId: canonicalRequestId,
            traceId: canonicalTraceId,
            intentId: canonicalIntentId,
          },
          { status: 202 },
        );
      } catch (fallbackError) {
        logger.error('fallback execution failed', { error: fallbackError });
        return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('runTimeline request failed', { error: message });
    const status = error instanceof SyntaxError || error instanceof ZodError ? 400 : 500;
    return NextResponse.json(
      {
        error: status === 400 ? 'Bad Request' : 'Internal Server Error',
        code: status === 400 ? 'invalid_request_body' : 'internal_error',
        ...(status === 400 ? { detail: message.slice(0, 240) } : {}),
      },
      { status },
    );
  }
}
