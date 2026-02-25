import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { isFastStewardReady } from '@/lib/agents/fast-steward-config';
import { runDebateScorecardSteward } from '@/lib/agents/debate-judge';
import { runDebateScorecardStewardFast } from '@/lib/agents/subagents/debate-steward-fast';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { createLogger } from '@/lib/logging';
import { parseJsonObject, stewardRunScorecardRequestSchema } from '@/lib/agents/shared/schemas';
import type { JsonObject, JsonValue } from '@/lib/utils/json-schema';
import {
  applyOrchestrationEnvelope,
  deriveDefaultLockKey,
  extractOrchestrationEnvelope,
} from '@/lib/agents/shared/orchestration-envelope';
import { deriveProviderParity } from '@/lib/agents/admin/provider-parity';
import {
  getRuntimeScopeResourceKey,
  normalizeRuntimeScope,
  resolveRuntimeScopeFromEnv,
} from '@/lib/agents/shared/runtime-scope';
import { resolveModelControl } from '@/lib/agents/control-plane/resolver';
import { resolveProviderKeyWithFallback } from '@/lib/agents/control-plane/key-resolution';

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

    const requesterUserId = await resolveRequestUserId(req);
    let billingUserId: string | null = null;
    if (BYOK_ENABLED) {
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
    const resolvedControl = await resolveModelControl({
      task: normalizedTask,
      room: trimmedRoom,
      userId: requesterUserId ?? undefined,
      billingUserId: billingUserId ?? undefined,
      requestProvider: undefined,
      includeUserScope: true,
    }).catch((error) => {
      logger.warn('model-control resolve failed; using env defaults', {
        room: trimmedRoom,
        task: normalizedTask,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        effective: { models: {}, knobs: {} },
        configVersion: 'env-fallback',
      };
    });
    const resolvedSearchModel = resolvedControl.effective.models?.searchModel;
    const scorecardFastEligible =
      normalizedTask !== 'scorecard.fact_check' &&
      normalizedTask !== 'scorecard.verify' &&
      normalizedTask !== 'scorecard.refute' &&
      normalizedTask !== 'scorecard.seed';
    const predictedFastPath = scorecardFastEligible && isFastStewardReady();

    logger.debug('POST received', {
      room: trimmedRoom,
      componentId: trimmedComponentId,
      task: normalizedTask,
      windowMs: resolvedWindow,
      summary: normalizedSummary,
      intent: normalizedIntent,
      topic: normalizedTopic,
      configVersion: resolvedControl.configVersion,
    });

    const passthrough = (parseJsonObject(rest) || {}) as Record<string, unknown>;
    delete passthrough.billingUserId;
    delete passthrough.requesterUserId;
    delete passthrough.sharedUnlockSessionId;
    delete passthrough.modelKeySource;
    delete passthrough.primaryModelKeySource;
    delete passthrough.fastModelKeySource;
    const normalizedParams = compactJsonObject({
      ...passthrough,
      room: trimmedRoom,
      componentId: trimmedComponentId,
      windowMs: resolvedWindow,
      summary: normalizedSummary,
      prompt: normalizedPrompt,
      intent: normalizedIntent,
      topic: normalizedTopic,
      configVersion: resolvedControl.configVersion,
      ...(resolvedSearchModel ? { searchModel: resolvedSearchModel } : {}),
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
        componentType: 'DebateScorecard',
      });
    const enrichedParams = applyOrchestrationEnvelope(normalizedParams, {
      ...orchestrationEnvelope,
      lockKey: normalizedLockKey,
    });
    const restRecord = parseJsonObject(rest) ?? {};
    const providerParity = deriveProviderParity({
      task: normalizedTask,
      status: 'queued',
      provider:
        typeof restRecord.provider === 'string' ? restRecord.provider : predictedFastPath ? 'cerebras' : 'openai',
      model: typeof restRecord.model === 'string' ? restRecord.model : undefined,
      providerSource:
        typeof restRecord.provider === 'string' ? 'explicit' : 'runtime_selected',
      providerPath:
        typeof restRecord.provider_path === 'string'
          ? restRecord.provider_path
          : predictedFastPath
            ? 'fast'
            : 'primary',
      providerRequestId:
        typeof restRecord.provider_request_id === 'string'
          ? restRecord.provider_request_id
          : undefined,
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
    if (BYOK_ENABLED && requesterUserId && billingUserId) {
      const openAiKey = await resolveProviderKeyWithFallback({
        req,
        provider: 'openai',
        userId: requesterUserId,
        billingUserId,
        roomScope: trimmedRoom,
      });
      const cerebrasKey = scorecardFastEligible
        ? await resolveProviderKeyWithFallback({
            req,
            provider: 'cerebras',
            userId: requesterUserId,
            billingUserId,
            roomScope: trimmedRoom,
          })
        : null;
      const selectedKey = openAiKey ?? cerebrasKey;
      const sharedUnlockSessionId = openAiKey?.sharedUnlockSessionId ?? cerebrasKey?.sharedUnlockSessionId;
      if (!selectedKey) {
        return NextResponse.json(
          {
            error: `BYOK_MISSING_KEY:${scorecardFastEligible ? 'openai_or_cerebras' : 'openai'}`,
          },
          { status: 400 },
        );
      }
      enrichedParams.modelKeySource = selectedKey.source;
      if (sharedUnlockSessionId) {
        enrichedParams.sharedUnlockSessionId = sharedUnlockSessionId;
      }
      if (openAiKey) {
        enrichedParams.primaryModelKeySource = openAiKey.source;
      }
      if (cerebrasKey) {
        enrichedParams.fastModelKeySource = cerebrasKey.source;
      }
    }
    const runtimeScope =
      normalizeRuntimeScope(enrichedParams.runtimeScope) ?? resolveRuntimeScopeFromEnv();
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
    const normalizedRequestId =
      typeof requestId === 'string' && requestId.trim() ? requestId.trim() : orchestrationEnvelope.idempotencyKey;

    try {
      const runtimeScopeKey = getRuntimeScopeResourceKey(
        typeof enrichedParams.runtimeScope === 'string' ? enrichedParams.runtimeScope : undefined,
      );
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
          ...(runtimeScopeKey ? [runtimeScopeKey] : []),
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

      const providerResolution =
        BYOK_ENABLED && requesterUserId && billingUserId
          ? await resolveProviderKeyWithFallback({
              req,
              provider: 'cerebras',
              userId: requesterUserId,
              billingUserId,
              roomScope: trimmedRoom,
            })
          : null;
      const cerebrasKey = providerResolution?.key ?? null;
      const openAiResolution =
        BYOK_ENABLED && requesterUserId && billingUserId
          ? await resolveProviderKeyWithFallback({
              req,
              provider: 'openai',
              userId: requesterUserId,
              billingUserId,
              roomScope: trimmedRoom,
            })
          : null;
      const useFast = scorecardFastEligible && isFastStewardReady(cerebrasKey ?? undefined);
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
            model:
              typeof enrichedParams.fastStewardModel === 'string'
                ? enrichedParams.fastStewardModel
                : undefined,
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
            model: typeof enrichedParams.model === 'string' ? enrichedParams.model : undefined,
            searchModel:
              typeof enrichedParams.searchModel === 'string' ? enrichedParams.searchModel : undefined,
            configVersion:
              typeof enrichedParams.configVersion === 'string' ? enrichedParams.configVersion : undefined,
            openaiApiKey: openAiResolution?.key ?? undefined,
          });
        }
        return NextResponse.json({ status: 'executed_fallback' }, { status: 202 });
      } catch (fallbackError) {
        logger.error('fallback execution failed', { error: fallbackError });
        return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('runScorecard request failed', { error: message });
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
