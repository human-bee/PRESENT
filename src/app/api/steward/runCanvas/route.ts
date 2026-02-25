import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
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
  isZodSchemaLike,
  parseJsonObject,
  stripUndefinedDeep,
  stewardRunCanvasRequestSchema,
} from '@/lib/agents/shared/schemas';
import { deriveRequestCorrelation } from '@/lib/agents/shared/request-correlation';
import type { JsonObject } from '@/lib/utils/json-schema';
import {
  applyOrchestrationEnvelope,
  deriveDefaultLockKey,
  extractOrchestrationEnvelope,
} from '@/lib/agents/shared/orchestration-envelope';
import type { ModelKeyProvider } from '@/lib/agents/shared/user-model-keys';
import { recordAgentTraceEvent } from '@/lib/agents/shared/trace-events';
import { deriveProviderParity } from '@/lib/agents/admin/provider-parity';
import {
  getRuntimeScopeResourceKey,
  normalizeRuntimeScope,
  resolveRuntimeScopeFromEnv,
} from '@/lib/agents/shared/runtime-scope';
import { resolveModelControl } from '@/lib/agents/control-plane/resolver';
import { resolveProviderKeyWithFallback } from '@/lib/agents/control-plane/key-resolution';
import type { ResolvedModelControl } from '@/lib/agents/control-plane/types';
import {
  assignmentToDiagnostics,
  attachExperimentAssignmentToMetadata,
  normalizeExperimentAssignment,
  readExperimentAssignmentFromUnknown,
} from '@/lib/agents/shared/experiment-assignment';

export const runtime = 'nodejs';

let queue: AgentTaskQueue | null = null;
function getQueue() {
  if (!queue) queue = new AgentTaskQueue();
  return queue;
}
const QUEUE_DIRECT_FALLBACK_ENABLED = process.env.CANVAS_QUEUE_DIRECT_FALLBACK === 'true';
const REQUIRE_TASK_TRACE_ID = process.env.CANVAS_REQUIRE_TASK_TRACE_ID === 'true';
const CANVAS_STEWARD_ENABLED = (process.env.CANVAS_STEWARD_SERVER_EXECUTION ?? 'true') === 'true';
// Server-first execution is canonical: client legacy flags must not disable steward execution.
const SERVER_CANVAS_AGENT_ENABLED = CANVAS_STEWARD_ENABLED;
const SERVER_CANVAS_TASKS_ENABLED = CANVAS_STEWARD_ENABLED;
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

const summarizeSchemaIssues = (error: z.ZodError): string[] => {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
};

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const body = stripUndefinedDeep(rawBody);
    if (!isZodSchemaLike(stewardRunCanvasRequestSchema)) {
      logger.error('runCanvas schema unavailable');
      return NextResponse.json({ error: 'Schema unavailable', code: 'schema_missing' }, { status: 500 });
    }

    const parsedResult = stewardRunCanvasRequestSchema.safeParse(body);
    if (!parsedResult.success) {
      const schemaIssues = summarizeSchemaIssues(parsedResult.error);
      const bodyRecord = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
      const traceRoom =
        bodyRecord && typeof bodyRecord.room === 'string' && bodyRecord.room.trim().length > 0
          ? bodyRecord.room.trim()
          : undefined;
      const traceTask =
        bodyRecord && typeof bodyRecord.task === 'string' && bodyRecord.task.trim().length > 0
          ? bodyRecord.task.trim()
          : 'canvas.agent_prompt';
      const traceRequestId =
        bodyRecord && typeof bodyRecord.requestId === 'string' && bodyRecord.requestId.trim().length > 0
          ? bodyRecord.requestId.trim()
          : undefined;
      const traceIntentId =
        bodyRecord && typeof bodyRecord.intentId === 'string' && bodyRecord.intentId.trim().length > 0
          ? bodyRecord.intentId.trim()
          : undefined;
      const traceTraceId =
        bodyRecord && typeof bodyRecord.traceId === 'string' && bodyRecord.traceId.trim().length > 0
          ? bodyRecord.traceId.trim()
          : undefined;

      logger.warn('runCanvas schema validation failed', {
        issues: schemaIssues,
        room: traceRoom,
        task: traceTask,
      });

      if (traceRoom) {
        await recordAgentTraceEvent({
          stage: 'failed',
          status: 'schema_invalid',
          traceId: traceTraceId,
          requestId: traceRequestId,
          intentId: traceIntentId,
          room: traceRoom,
          task: traceTask,
          payload: {
            code: 'schema_invalid',
            issues: schemaIssues,
          },
        });
      }

      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'schema_invalid',
          issues: schemaIssues,
        },
        { status: 400 },
      );
    }

    const parsed = parsedResult.data;
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
    delete normalizedParams.billingUserId;
    delete normalizedParams.requesterUserId;
    delete normalizedParams.sharedUnlockSessionId;
    delete normalizedParams.modelKeySource;
    delete normalizedParams.primaryModelKeySource;
    delete normalizedParams.fastModelKeySource;
    const explicitExperimentAssignment = normalizeExperimentAssignment({
      experiment_id: parsed.experiment_id,
      variant_id: parsed.variant_id,
      assignment_namespace: parsed.assignment_namespace,
      assignment_unit: parsed.assignment_unit,
      assignment_ts: parsed.assignment_ts,
      factor_levels: parsed.factor_levels,
    });
    const requestExperimentAssignment =
      explicitExperimentAssignment ??
      readExperimentAssignmentFromUnknown(normalizedParams.metadata) ??
      readExperimentAssignmentFromUnknown(normalizedParams.experiment) ??
      null;

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
    const requesterUserId = await resolveRequestUserId(req);
    let billingUserId: string | undefined;
    if (BYOK_ENABLED) {
      if (!requesterUserId) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const canvasId = parseCanvasIdFromRoom(trimmedRoom);
      if (!canvasId) {
        return NextResponse.json({ error: 'invalid_room' }, { status: 400 });
      }
      try {
        const { ownerUserId } = await assertCanvasMember({ canvasId, requesterUserId });
        billingUserId = ownerUserId;
        normalizedParams.billingUserId = ownerUserId;
        normalizedParams.requesterUserId = requesterUserId;
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'forbidden') {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        throw error;
      }
    }

    const resolvedControl: ResolvedModelControl = await resolveModelControl({
      task: normalizedTask,
      room: trimmedRoom,
      userId: requesterUserId ?? undefined,
      billingUserId,
      requestModel: model,
      requestProvider: provider ?? undefined,
      allowRequestModelOverride: true,
      includeUserScope: true,
    }).catch((error): ResolvedModelControl => {
      logger.warn('model-control resolve failed; using env defaults', {
        room: trimmedRoom,
        task: normalizedTask,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        effective: { models: {}, knobs: {} },
        sources: [],
        applyModes: {},
        fieldSources: {},
        resolvedAt: new Date().toISOString(),
        configVersion: 'env-fallback',
      };
    });
    const resolvedCanvasModel = model ?? resolvedControl.effective.models?.canvasSteward;
    const canvasKnobs = resolvedControl.effective.knobs?.canvas;
    const canvasConfigOverrides =
      canvasKnobs
        ? {
            ...(canvasKnobs.preset ? { preset: canvasKnobs.preset } : {}),
            ...(typeof canvasKnobs.ttfbSloMs === 'number' ? { ttfbSloMs: canvasKnobs.ttfbSloMs } : {}),
            ...(typeof canvasKnobs.transcriptWindowMs === 'number'
              ? { transcriptWindowMs: canvasKnobs.transcriptWindowMs }
              : {}),
            screenshot: {
              ...(typeof canvasKnobs.screenshotTimeoutMs === 'number'
                ? { timeoutMs: canvasKnobs.screenshotTimeoutMs }
                : {}),
              ...(typeof canvasKnobs.screenshotRetries === 'number'
                ? { retries: canvasKnobs.screenshotRetries }
                : {}),
              ...(typeof canvasKnobs.screenshotRetryDelayMs === 'number'
                ? { retryDelayMs: canvasKnobs.screenshotRetryDelayMs }
                : {}),
            },
            prompt: {
              ...(typeof canvasKnobs.promptMaxChars === 'number' ? { maxChars: canvasKnobs.promptMaxChars } : {}),
            },
            followups: {
              ...(typeof canvasKnobs.followupMaxDepth === 'number'
                ? { maxDepth: canvasKnobs.followupMaxDepth }
                : {}),
              ...(typeof canvasKnobs.lowActionThreshold === 'number'
                ? { lowActionThreshold: canvasKnobs.lowActionThreshold }
                : {}),
            },
          }
        : null;
    const resolvedProvider =
      provider ??
      deriveProviderFromModel(resolvedCanvasModel) ??
      deriveProviderFromModel(normalizedParams.model) ??
      null;
    if (resolvedProvider && !normalizedParams.provider) {
      normalizedParams.provider = resolvedProvider;
    }
    if (resolvedCanvasModel && !normalizedParams.model) {
      normalizedParams.model = resolvedCanvasModel;
    }
    if (!normalizedParams.configVersion) {
      normalizedParams.configVersion = resolvedControl.configVersion;
    }
    if (canvasConfigOverrides && !normalizedParams.canvasConfigOverrides) {
      normalizedParams.canvasConfigOverrides = canvasConfigOverrides;
    }
    if (BYOK_ENABLED && requesterUserId && billingUserId) {
      const providerToCheck = resolvedProvider ?? 'openai';
      const resolvedKey = await resolveProviderKeyWithFallback({
        req,
        provider: providerToCheck,
        userId: requesterUserId,
        billingUserId,
        roomScope: trimmedRoom,
      });
      if (!resolvedKey) {
        return NextResponse.json(
          { error: `BYOK_MISSING_KEY:${providerToCheck}` },
          { status: 400 },
        );
      }
      normalizedParams.modelKeySource = resolvedKey.source;
      if (resolvedKey.sharedUnlockSessionId) {
        normalizedParams.sharedUnlockSessionId = resolvedKey.sharedUnlockSessionId;
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
    let canonicalRequestId = correlation.requestId;
    const explicitTraceId = typeof traceId === 'string' && traceId.trim() ? traceId.trim() : undefined;
    const explicitIntentId = typeof intentId === 'string' && intentId.trim() ? intentId.trim() : undefined;
    let canonicalTraceId =
      explicitTraceId ??
      (typeof enrichedParams.traceId === 'string' && enrichedParams.traceId.trim() ? enrichedParams.traceId.trim() : undefined) ??
      correlation.traceId;
    const canonicalIntentId = explicitIntentId ?? correlation.intentId;
    const generatedCorrelationId = randomUUID();
    if (!canonicalRequestId) {
      canonicalRequestId = `req-${generatedCorrelationId}`;
    }
    if (!canonicalTraceId) {
      canonicalTraceId = canonicalRequestId;
    }

    if (canonicalRequestId && !enrichedParams.requestId) {
      enrichedParams.requestId = canonicalRequestId;
    }
    if (normalizedTask === 'fairy.intent' && canonicalIntentId && (!enrichedParams.id || explicitIntentId)) {
      enrichedParams.id = canonicalIntentId;
    }
    if (canonicalTraceId && (!enrichedParams.traceId || explicitTraceId)) {
      enrichedParams.traceId = canonicalTraceId;
    }
    const metadataForCorrelationBase: JsonObject = parseMetadata(enrichedParams.metadata) ?? {};
    const metadataForCorrelation =
      attachExperimentAssignmentToMetadata(metadataForCorrelationBase, requestExperimentAssignment) ??
      metadataForCorrelationBase;
    if (!metadataForCorrelation.configVersion && typeof enrichedParams.configVersion === 'string') {
      metadataForCorrelation.configVersion = enrichedParams.configVersion;
    }
    if (canonicalTraceId && (!metadataForCorrelation.traceId || explicitTraceId)) {
      metadataForCorrelation.traceId = canonicalTraceId;
    }
    if (canonicalIntentId && (!metadataForCorrelation.intentId || explicitIntentId)) {
      metadataForCorrelation.intentId = canonicalIntentId;
    }
    const runtimeScope =
      normalizeRuntimeScope(enrichedParams.runtimeScope) ?? resolveRuntimeScopeFromEnv();
    if (runtimeScope) {
      enrichedParams.runtimeScope = runtimeScope;
      if (!metadataForCorrelation.runtimeScope) {
        metadataForCorrelation.runtimeScope = runtimeScope;
      }
    }
    if (Object.keys(metadataForCorrelation).length > 0) {
      enrichedParams.metadata = metadataForCorrelation;
    }
    if (requestExperimentAssignment) {
      enrichedParams.experiment_id = requestExperimentAssignment.experiment_id;
      enrichedParams.variant_id = requestExperimentAssignment.variant_id;
      enrichedParams.assignment_namespace = requestExperimentAssignment.assignment_namespace;
      enrichedParams.assignment_unit = requestExperimentAssignment.assignment_unit;
      enrichedParams.assignment_ts = requestExperimentAssignment.assignment_ts;
      enrichedParams.factor_levels = requestExperimentAssignment.factor_levels;
    }

    if (normalizedTask === 'canvas.agent_prompt' && !enrichedParams.message) {
      return NextResponse.json({ error: 'Missing message for canvas.agent_prompt' }, { status: 400 });
    }
    const experimentDiagnostics = assignmentToDiagnostics(requestExperimentAssignment);

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
        ...(experimentDiagnostics ? { experiment: experimentDiagnostics } : {}),
      },
    });

    try {
      const baseResourceKeys =
        normalizedTask === 'canvas.agent_prompt' || normalizedTask === 'fairy.intent'
          ? [`room:${trimmedRoom}`, 'canvas:intent']
          : [`room:${trimmedRoom}`];
      const runtimeScopeKey = getRuntimeScopeResourceKey(
        typeof enrichedParams.runtimeScope === 'string' ? enrichedParams.runtimeScope : undefined,
      );
      const scopedResourceKeys = runtimeScopeKey ? [...baseResourceKeys, runtimeScopeKey] : baseResourceKeys;
      const normalizedResourceKeys = normalizedLockKey
        ? [...scopedResourceKeys, `lock:${normalizedLockKey}`]
        : scopedResourceKeys;

      const enqueueResult = await getQueue().enqueueTask({
        room: trimmedRoom,
        task: normalizedTask,
        params: enrichedParams,
        requestId: canonicalRequestId,
        dedupeKey: orchestrationEnvelope.idempotencyKey,
        lockKey: normalizedLockKey,
        idempotencyKey: orchestrationEnvelope.idempotencyKey,
        resourceKeys: normalizedResourceKeys,
        coalesceByResource: normalizedTask === 'canvas.agent_prompt',
        coalesceTaskFilter: normalizedTask === 'canvas.agent_prompt' ? ['canvas.agent_prompt'] : undefined,
        requireTraceId: REQUIRE_TASK_TRACE_ID && normalizedTask === 'fairy.intent',
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
          ...(experimentDiagnostics ? { experiment: experimentDiagnostics } : {}),
        },
        { status: 202 },
      );
    } catch (error) {
      const msg = summarizeQueueError(error);
      const strictTraceFailure =
        msg.includes('TRACE_ID_REQUIRED:') ||
        msg.includes('TRACE_ID_COLUMN_REQUIRED:') ||
        msg.includes('TRACE_ID_NOT_PERSISTED:');
      if (strictTraceFailure) {
        logger.error('queue enqueue failed strict trace integrity check', { error: msg });
        await recordAgentTraceEvent({
          stage: 'failed',
          status: 'queue_trace_integrity_error',
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
            reason: msg,
            provider: providerParity.provider,
            model: providerParity.model,
            providerSource: providerParity.providerSource,
            providerPath: providerParity.providerPath,
            providerRequestId: providerParity.providerRequestId,
            ...(experimentDiagnostics ? { experiment: experimentDiagnostics } : {}),
          },
        });
        return NextResponse.json(
          { error: 'Queue trace integrity check failed', code: 'queue_trace_integrity_error' },
          { status: 503 },
        );
      }
      logger.warn('queue enqueue failed, falling back to direct run', { error: msg });
      const fallbackParams: JsonObject = {
        ...enrichedParams,
        provider_path: 'fallback',
      };

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
        params: fallbackParams,
        payload: {
          reason: msg,
          provider: providerParity.provider,
          model: providerParity.model,
          providerSource: providerParity.providerSource,
          providerPath: 'fallback',
          providerRequestId: providerParity.providerRequestId,
          ...(experimentDiagnostics ? { experiment: experimentDiagnostics } : {}),
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
        await runCanvasSteward({ task: normalizedTask, params: fallbackParams });
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
          params: fallbackParams,
          payload: {
            provider: providerParity.provider,
            model: providerParity.model,
            providerSource: providerParity.providerSource,
            providerPath: 'fallback',
            providerRequestId: providerParity.providerRequestId,
            ...(experimentDiagnostics ? { experiment: experimentDiagnostics } : {}),
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
          params: fallbackParams,
          payload: {
            error: e instanceof Error ? e.message : String(e),
            provider: providerParity.provider,
            model: providerParity.model,
            providerSource: providerParity.providerSource,
            providerPath: 'fallback',
            providerRequestId: providerParity.providerRequestId,
            ...(experimentDiagnostics ? { experiment: experimentDiagnostics } : {}),
          },
        });
        return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('runCanvas request failed', { error: message });
    const status = error instanceof SyntaxError ? 400 : 500;
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
