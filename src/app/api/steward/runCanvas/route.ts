import { NextRequest, NextResponse } from 'next/server';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { runCanvasSteward } from '@/lib/agents/subagents/canvas-steward';
import {
  broadcastAgentPrompt,
  type CanvasAgentPromptPayload,
} from '@/lib/agents/shared/supabase-context';
import { randomUUID } from 'crypto';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { createLogger } from '@/lib/logging';
import {
  parseJsonObject,
  stewardRunCanvasRequestSchema,
} from '@/lib/agents/shared/schemas';
import { deriveRequestCorrelation } from '@/lib/agents/shared/request-correlation';
import type { JsonObject } from '@/lib/utils/json-schema';
import { getBooleanFlag } from '@/lib/feature-flags';
import {
  applyOrchestrationEnvelope,
  deriveDefaultLockKey,
  extractOrchestrationEnvelope,
} from '@/lib/agents/shared/orchestration-envelope';
import { getDecryptedUserModelKey, type ModelKeyProvider } from '@/lib/agents/shared/user-model-keys';
import { recordAgentTraceEvent } from '@/lib/agents/shared/trace-events';
import { deriveProviderParity } from '@/lib/agents/admin/provider-parity';

export const runtime = 'nodejs';

let queue: AgentTaskQueue | null = null;
function getQueue() {
  if (!queue) queue = new AgentTaskQueue();
  return queue;
}
const QUEUE_DIRECT_FALLBACK_ENABLED = process.env.CANVAS_QUEUE_DIRECT_FALLBACK === 'true';
const CLIENT_CANVAS_AGENT_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED, false);
const CANVAS_STEWARD_ENABLED = (process.env.CANVAS_STEWARD_SERVER_EXECUTION ?? 'true') === 'true';
const SERVER_CANVAS_AGENT_ENABLED = CANVAS_STEWARD_ENABLED && !CLIENT_CANVAS_AGENT_ENABLED;
const SERVER_CANVAS_TASKS_ENABLED = CANVAS_STEWARD_ENABLED && !CLIENT_CANVAS_AGENT_ENABLED;
const logger = createLogger('api:steward:runCanvas');

const parseBounds = (value: unknown): CanvasAgentPromptPayload['bounds'] | undefined => {
  const record = parseJsonObject(value);
  if (!record) return undefined;
  if (
    typeof record.x !== 'number' ||
    typeof record.y !== 'number' ||
    typeof record.w !== 'number' ||
    typeof record.h !== 'number'
  ) {
    return undefined;
  }
  return { x: record.x, y: record.y, w: record.w, h: record.h };
};

const parseSelectionIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
};

const parseMetadata = (value: unknown): JsonObject | null => {
  const metadata = parseJsonObject(value);
  return metadata ?? null;
};

const normalizeProvider = (value: unknown): ModelKeyProvider | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'openai') return 'openai';
  if (normalized === 'anthropic') return 'anthropic';
  if (normalized === 'google') return 'google';
  if (normalized === 'together') return 'together';
  if (normalized === 'cerebras') return 'cerebras';
  return null;
};

const deriveProviderFromModel = (model: unknown): ModelKeyProvider | null => {
  if (typeof model !== 'string') return null;
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('openai:') || normalized.startsWith('gpt')) return 'openai';
  if (normalized.startsWith('anthropic:') || normalized.startsWith('claude')) return 'anthropic';
  if (normalized.startsWith('google:') || normalized.startsWith('gemini')) return 'google';
  if (normalized.startsWith('cerebras:') || normalized.startsWith('llama') || normalized.startsWith('qwen') || normalized.startsWith('gpt-oss')) return 'cerebras';
  if (normalized.startsWith('together:') || normalized.includes('black-forest-labs/') || normalized.includes('flux')) return 'together';
  return null;
};

const summarizeQueueError = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = ['code', 'message', 'details', 'hint']
      .map((key) => {
        const value = record[key];
        return typeof value === 'string' && value.trim() ? value.trim() : null;
      })
      .filter((value): value is string => Boolean(value));
    if (parts.length > 0) return parts.join(' | ');
    try {
      return JSON.stringify(record);
    } catch {
      // fall through to generic cast
    }
  }
  return String(error);
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = stewardRunCanvasRequestSchema.parse(body);
    const room = parsed.room;
    const task = parsed.task;
    const summary = parsed.summary;
    const message = parsed.message;
    const requestId = parsed.requestId;
    const traceId = parsed.traceId;
    const intentId = parsed.intentId;
    const executionId = parsed.executionId;
    const idempotencyKey = parsed.idempotencyKey;
    const lockKey = parsed.lockKey;
    const attempt = parsed.attempt;
    const normalizedParams: JsonObject = { ...(parsed.params ?? {}) };

    const explicitProvider = normalizeProvider(parsed.provider);
    const paramProvider = normalizeProvider(normalizedParams.provider);
    const provider = explicitProvider ?? paramProvider;
    const providerSource =
      explicitProvider
        ? 'explicit'
        : paramProvider
          ? 'task_params'
          : typeof parsed.model === 'string' || typeof normalizedParams.model === 'string'
            ? 'model_inferred'
            : 'unknown';
    const model =
      typeof parsed.model === 'string' && parsed.model.trim()
        ? parsed.model.trim()
        : typeof normalizedParams.model === 'string' && normalizedParams.model.trim()
          ? normalizedParams.model.trim()
          : undefined;

    if (room.trim().length === 0) {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }

    const normalizedTask = typeof task === 'string' && task.trim() ? task.trim() : 'canvas.agent_prompt';
    const trimmedRoom = room.trim();
    if (provider && !normalizedParams.provider) {
      normalizedParams.provider = provider;
    }
    if (model && !normalizedParams.model) {
      normalizedParams.model = model;
    }

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
        const { ownerUserId } = await assertCanvasMember({ canvasId, requesterUserId });
        normalizedParams.billingUserId = ownerUserId;
        const providerToCheck =
          provider ?? deriveProviderFromModel(model) ?? deriveProviderFromModel(normalizedParams.model) ?? 'openai';
        const providerKey = await getDecryptedUserModelKey({ userId: ownerUserId, provider: providerToCheck });
        if (!providerKey) {
          return NextResponse.json({ error: `BYOK_MISSING_KEY:${providerToCheck}` }, { status: 400 });
        }
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'forbidden') {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        throw error;
      }
    }

    if (!normalizedParams.room) {
      normalizedParams.room = trimmedRoom;
    } else if (typeof normalizedParams.room === 'string') {
      const candidate = normalizedParams.room.trim();
      if (!candidate || candidate === 'CURRENT_ROOM' || candidate === 'ROOM_NAME_PLACEHOLDER') {
        normalizedParams.room = trimmedRoom;
      } else {
        normalizedParams.room = candidate;
      }
    } else {
      normalizedParams.room = trimmedRoom;
    }

    if (typeof message === 'string' && message.trim()) {
      normalizedParams.message = message.trim();
    }

    if (typeof summary === 'string' && summary.trim()) {
      normalizedParams.summary = summary.trim();
    }

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
        componentId:
          typeof normalizedParams.componentId === 'string'
            ? normalizedParams.componentId
            : undefined,
        componentType:
          typeof normalizedParams.type === 'string'
            ? normalizedParams.type
            : typeof normalizedParams.componentType === 'string'
              ? normalizedParams.componentType
              : undefined,
      });
    const enrichedParams = applyOrchestrationEnvelope(normalizedParams, {
      ...orchestrationEnvelope,
      lockKey: normalizedLockKey,
    });
    const providerParity = deriveProviderParity({
      task: normalizedTask,
      status: 'ok',
      provider: provider ?? undefined,
      model,
      providerSource,
      providerPath: 'primary',
      params: enrichedParams,
    });
    enrichedParams.provider = providerParity.provider;
    if (providerParity.model) {
      enrichedParams.model = providerParity.model;
    }
    enrichedParams.provider_source = providerParity.providerSource;
    enrichedParams.provider_path = providerParity.providerPath;
    if (providerParity.providerRequestId) {
      enrichedParams.provider_request_id = providerParity.providerRequestId;
    }

    const correlation = deriveRequestCorrelation({
      task: normalizedTask,
      requestId:
        (typeof requestId === 'string' && requestId.trim()) ||
        orchestrationEnvelope.idempotencyKey ||
        intentId ||
        (typeof enrichedParams.requestId === 'string' ? enrichedParams.requestId : undefined),
      params: enrichedParams,
    });
    const canonicalRequestId = correlation.requestId;
    const explicitTraceId = typeof traceId === 'string' && traceId.trim() ? traceId.trim() : undefined;
    const explicitIntentId = typeof intentId === 'string' && intentId.trim() ? intentId.trim() : undefined;
    const canonicalTraceId =
      explicitTraceId ??
      (typeof enrichedParams.traceId === 'string' && enrichedParams.traceId.trim() ? enrichedParams.traceId.trim() : undefined) ??
      correlation.traceId;
    const canonicalIntentId = explicitIntentId ?? correlation.intentId;

    if (canonicalRequestId && !enrichedParams.requestId) {
      enrichedParams.requestId = canonicalRequestId;
    }
    if (normalizedTask === 'fairy.intent' && canonicalIntentId && (!enrichedParams.id || explicitIntentId)) {
      enrichedParams.id = canonicalIntentId;
    }
    if (canonicalTraceId && (!enrichedParams.traceId || explicitTraceId)) {
      enrichedParams.traceId = canonicalTraceId;
    }
    const metadataForCorrelation: JsonObject = parseMetadata(enrichedParams.metadata) ?? {};
    if (canonicalTraceId && (!metadataForCorrelation.traceId || explicitTraceId)) {
      metadataForCorrelation.traceId = canonicalTraceId;
    }
    if (canonicalIntentId && (!metadataForCorrelation.intentId || explicitIntentId)) {
      metadataForCorrelation.intentId = canonicalIntentId;
    }
    if (Object.keys(metadataForCorrelation).length > 0) {
      enrichedParams.metadata = metadataForCorrelation;
    }

    if (normalizedTask === 'canvas.agent_prompt' && !enrichedParams.message) {
      return NextResponse.json({ error: 'Missing message for canvas.agent_prompt' }, { status: 400 });
    }

    await recordAgentTraceEvent({
      stage: 'api_received',
      status: 'ok',
      traceId: canonicalTraceId,
      requestId: canonicalRequestId,
      intentId: canonicalIntentId,
      room: trimmedRoom,
      task: normalizedTask,
      provider: providerParity.provider,
      model: providerParity.model ?? undefined,
      providerSource: providerParity.providerSource,
      providerPath: providerParity.providerPath,
      providerRequestId: providerParity.providerRequestId ?? undefined,
      params: enrichedParams,
      payload: {
        provider: providerParity.provider,
        model: providerParity.model,
        providerSource: providerParity.providerSource,
        providerPath: providerParity.providerPath,
        providerRequestId: providerParity.providerRequestId,
      },
    });

    try {
      const baseResourceKeys =
        normalizedTask === 'canvas.agent_prompt' || normalizedTask === 'fairy.intent'
          ? [`room:${trimmedRoom}`, 'canvas:intent']
          : [`room:${trimmedRoom}`];
      const normalizedResourceKeys = normalizedLockKey
        ? [...baseResourceKeys, `lock:${normalizedLockKey}`]
        : baseResourceKeys;

      const enqueueResult = await getQueue().enqueueTask({
        room: trimmedRoom,
        task: normalizedTask,
        params: enrichedParams,
        requestId: canonicalRequestId,
        dedupeKey: orchestrationEnvelope.idempotencyKey,
        lockKey: normalizedLockKey,
        idempotencyKey: orchestrationEnvelope.idempotencyKey,
        resourceKeys: normalizedResourceKeys,
        coalesceByResource: normalizedTask === 'canvas.agent_prompt' || normalizedTask === 'fairy.intent',
      });

      if (normalizedTask === 'canvas.agent_prompt') {
        try {
          const rid = canonicalRequestId || randomUUID();
          await broadcastAgentPrompt({
            room: trimmedRoom,
            payload: {
              message: String(enrichedParams.message || '').trim(),
              requestId: rid,
              bounds: parseBounds(enrichedParams.bounds),
              selectionIds: parseSelectionIds(enrichedParams.selectionIds),
              metadata: parseMetadata(enrichedParams.metadata),
            },
          });
        } catch (e) {
          logger.warn('broadcast agent prompt failed (post-enqueue)', { error: e });
        }
      }

      return NextResponse.json(
        {
          status: 'queued',
          task: enqueueResult,
          taskId: enqueueResult?.id ?? null,
          requestId: canonicalRequestId ?? null,
          traceId: canonicalTraceId ?? null,
          intentId: canonicalIntentId ?? null,
        },
        { status: 202 },
      );
    } catch (error) {
      const msg = summarizeQueueError(error);
      logger.warn('queue enqueue failed, falling back to direct run', { error: msg });

      await recordAgentTraceEvent({
        stage: 'fallback',
        status: 'queue_error',
        traceId: canonicalTraceId,
        requestId: canonicalRequestId,
        intentId: canonicalIntentId,
        room: trimmedRoom,
        task: normalizedTask,
        provider: providerParity.provider,
        model: providerParity.model ?? undefined,
        providerSource: providerParity.providerSource,
        providerPath: 'fallback',
        providerRequestId: providerParity.providerRequestId ?? undefined,
        params: enrichedParams,
        payload: {
          reason: msg,
          provider: providerParity.provider,
          model: providerParity.model,
          providerSource: providerParity.providerSource,
          providerPath: 'fallback',
          providerRequestId: providerParity.providerRequestId,
        },
      });

      if (normalizedTask === 'canvas.agent_prompt') {
        try {
          const rid = canonicalRequestId || randomUUID();
          await broadcastAgentPrompt({
            room: trimmedRoom,
            payload: {
              message: String(enrichedParams.message || '').trim(),
              requestId: rid,
              bounds: parseBounds(enrichedParams.bounds),
              selectionIds: parseSelectionIds(enrichedParams.selectionIds),
              metadata: parseMetadata(enrichedParams.metadata),
            },
          });
        } catch (e) {
          logger.warn('broadcast agent prompt failed in fallback', { error: e });
        }
      }

      if (!QUEUE_DIRECT_FALLBACK_ENABLED) {
        if (normalizedTask === 'canvas.agent_prompt' && !SERVER_CANVAS_AGENT_ENABLED) {
          return NextResponse.json({ status: 'broadcast_only' }, { status: 202 });
        }
        return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 });
      }

      const canExecuteFallback =
        normalizedTask === 'canvas.agent_prompt' ? SERVER_CANVAS_AGENT_ENABLED : SERVER_CANVAS_TASKS_ENABLED;
      if (!canExecuteFallback) {
        return NextResponse.json({ status: 'broadcast_only' }, { status: 202 });
      }

      try {
        await runCanvasSteward({ task: normalizedTask, params: enrichedParams });
        await recordAgentTraceEvent({
          stage: 'completed',
          status: 'executed_fallback',
          traceId: canonicalTraceId,
          requestId: canonicalRequestId,
          intentId: canonicalIntentId,
          room: trimmedRoom,
          task: normalizedTask,
          provider: providerParity.provider,
          model: providerParity.model ?? undefined,
          providerSource: providerParity.providerSource,
          providerPath: 'fallback',
          providerRequestId: providerParity.providerRequestId ?? undefined,
          params: enrichedParams,
          payload: {
            provider: providerParity.provider,
            model: providerParity.model,
            providerSource: providerParity.providerSource,
            providerPath: 'fallback',
            providerRequestId: providerParity.providerRequestId,
          },
        });
        return NextResponse.json({ status: 'executed_fallback' }, { status: 202 });
      } catch (e) {
        logger.error('fallback execution failed', { error: e });
        await recordAgentTraceEvent({
          stage: 'failed',
          status: 'fallback_error',
          traceId: canonicalTraceId,
          requestId: canonicalRequestId,
          intentId: canonicalIntentId,
          room: trimmedRoom,
          task: normalizedTask,
          provider: providerParity.provider,
          model: providerParity.model ?? undefined,
          providerSource: providerParity.providerSource,
          providerPath: 'fallback',
          providerRequestId: providerParity.providerRequestId ?? undefined,
          params: enrichedParams,
          payload: {
            error: e instanceof Error ? e.message : String(e),
            provider: providerParity.provider,
            model: providerParity.model,
            providerSource: providerParity.providerSource,
            providerPath: 'fallback',
            providerRequestId: providerParity.providerRequestId,
          },
        });
        return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
      }
    }
  } catch (error) {
    logger.error('request parse failure', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
