import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from '@/lib/utils/json-schema';
import { runCanvasAgent } from '@/lib/agents/canvas-agent/server/runner';
import type { CanvasFollowupInput } from '@/lib/agents/canvas-agent/server/followup-queue';
import { awaitAck, sendActionsEnvelope } from '@/lib/agents/canvas-agent/server/wire';
import type { AgentAction } from '@/lib/canvas-agent/contract/types';
import { parseAction } from '@/lib/canvas-agent/contract/parsers';
import { resolveShapeType, sanitizeShapeProps } from '@/lib/canvas-agent/contract/shape-utils';
import { normalizeFairyContextProfile } from '@/lib/fairy-context/profiles';
import { deriveRequestCorrelation } from '@/lib/agents/shared/request-correlation';
import { getDecryptedUserModelKey, type ModelKeyProvider } from '@/lib/agents/shared/user-model-keys';
import { withRuntimeModelKeys } from '@/lib/agents/shared/model-runtime-context';
import { createLogger } from '@/lib/logging';

const logger = createLogger('agents:subagents:canvas-steward');

const logWithTs = <T extends Record<string, unknown>>(label: string, payload: T) => {
  logger.info(label, { ts: new Date().toISOString(), ...payload });
};

const CANVAS_STEWARD_DEBUG = process.env.CANVAS_STEWARD_DEBUG === 'true';
const debugLog = (...args: unknown[]) => {
  if (CANVAS_STEWARD_DEBUG) {
    logger.debug('[CanvasSteward]', ...args);
  }
};
const _debugJson = (label: string, value: unknown, max = 2000) => {
  if (!CANVAS_STEWARD_DEBUG) return;
  try {
    const json = JSON.stringify(value, null, 2);
    debugLog(label, json.length > max ? `${json.slice(0, max)}… (truncated ${json.length - max} chars)` : json);
  } catch (_error) {
    debugLog(label, value);
  }
};

const ParamEntry = z.object({
  key: z.string(),
  value: jsonValueSchema,
});
type ParamEntryType = z.infer<typeof ParamEntry>;

type RunCanvasStewardArgs = {
  task: string;
  params: JsonObject | ParamEntryType[];
};

type CanvasViewport = { x: number; y: number; w: number; h: number };
type QuickTextShapeType = 'text' | 'note';
type QuickTextTargetHint = 'bunny' | 'forest' | 'center';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const QUICK_TEXT_ACK_TIMEOUT_MS = parsePositiveInt(process.env.CANVAS_QUICK_TEXT_ACK_TIMEOUT_MS, 2000);
const QUICK_TEXT_ACK_RETRIES = parsePositiveInt(process.env.CANVAS_QUICK_TEXT_ACK_RETRIES, 2);
const QUICK_TEXT_ACK_RETRY_DELAY_MS = parsePositiveInt(process.env.CANVAS_QUICK_TEXT_ACK_RETRY_DELAY_MS, 200);
const GRAPH_FALLBACK_PATTERN =
  /\b(graph|plot|equation|function|parabola|line graph|bar chart|axis|axes|coordinate|y\s*=|f\s*\(x\)\s*=)\b/i;
const GRAPH_EQUATION_PATTERN = /\b(?:y|f\s*\(x\)|x)\s*=\s*([^\n]+)/i;

const inferProviderFromModel = (model?: string): ModelKeyProvider | null => {
  if (!model) return null;
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('openai:') || normalized.startsWith('gpt')) return 'openai';
  if (normalized.startsWith('anthropic:') || normalized.startsWith('claude')) return 'anthropic';
  if (normalized.startsWith('google:') || normalized.startsWith('gemini')) return 'google';
  return null;
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

const parseViewport = (value: unknown): CanvasViewport | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y) ||
    typeof candidate.w !== 'number' ||
    !Number.isFinite(candidate.w) ||
    typeof candidate.h !== 'number' ||
    !Number.isFinite(candidate.h)
  ) {
    return undefined;
  }
  return { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h };
};

const normalizeQuickTextShapeType = (value: unknown): QuickTextShapeType => {
  if (typeof value !== 'string') return 'text';
  const normalized = value.trim().toLowerCase();
  return normalized === 'note' ? 'note' : 'text';
};

const normalizeQuickTextTargetHint = (value: unknown): QuickTextTargetHint | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'bunny') return 'bunny';
  if (normalized === 'forest') return 'forest';
  if (normalized === 'center') return 'center';
  return undefined;
};

const readJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const deterministicNumberFromHex = (hex: string, min: number, max: number): number => {
  if (max <= min) return min;
  const parsed = Number.parseInt(hex, 16);
  const range = max - min + 1;
  const normalized = Number.isFinite(parsed) ? parsed : 0;
  return min + (Math.abs(normalized) % range);
};

const pickQuickTextPlacementBounds = (payload: JsonObject): CanvasViewport | undefined => {
  const metadata = readJsonObject(payload.metadata);
  const viewContext = readJsonObject(metadata?.viewContext);
  const promptSummary = readJsonObject(metadata?.promptSummary);

  return (
    parseViewport(payload.bounds) ??
    parseViewport(payload.viewport) ??
    parseViewport(payload.selectionBounds) ??
    parseViewport(metadata?.bounds) ??
    parseViewport(metadata?.viewport) ??
    parseViewport(viewContext?.viewport) ??
    parseViewport(promptSummary?.viewport)
  );
};

const resolveQuickTextTargetHint = (payload: JsonObject): QuickTextTargetHint | undefined => {
  const metadata = readJsonObject(payload.metadata);
  return (
    normalizeQuickTextTargetHint(payload.targetHint) ??
    normalizeQuickTextTargetHint(payload.target) ??
    normalizeQuickTextTargetHint(metadata?.targetHint) ??
    normalizeQuickTextTargetHint(metadata?.target)
  );
};

const resolveQuickTextPlacement = (
  room: string,
  requestId: string,
  text: string,
  payload: JsonObject,
  targetHint?: QuickTextTargetHint,
): { x: number; y: number } => {
  const explicitX = typeof payload.x === 'number' && Number.isFinite(payload.x) ? payload.x : undefined;
  const explicitY = typeof payload.y === 'number' && Number.isFinite(payload.y) ? payload.y : undefined;
  if (typeof explicitX === 'number' && typeof explicitY === 'number') {
    return { x: Math.round(explicitX), y: Math.round(explicitY) };
  }

  const bounds = pickQuickTextPlacementBounds(payload);
  if (bounds) {
    if (targetHint === 'bunny') {
      return {
        x: Math.round(bounds.x + bounds.w * 0.38),
        y: Math.round(bounds.y + bounds.h * 0.36),
      };
    }
    if (targetHint === 'forest') {
      return {
        x: Math.round(bounds.x + bounds.w * 0.72),
        y: Math.round(bounds.y + bounds.h * 0.62),
      };
    }
    if (targetHint === 'center') {
      return {
        x: Math.round(bounds.x + bounds.w * 0.5),
        y: Math.round(bounds.y + bounds.h * 0.5),
      };
    }
    const insetX = Math.max(24, Math.min(120, Math.round(bounds.w * 0.12)));
    const insetY = Math.max(20, Math.min(96, Math.round(bounds.h * 0.14)));
    return {
      x: Math.round(bounds.x + insetX),
      y: Math.round(bounds.y + insetY),
    };
  }

  if (targetHint === 'bunny') {
    return { x: 80, y: -80 };
  }
  if (targetHint === 'forest') {
    return { x: 200, y: 150 };
  }
  if (targetHint === 'center') {
    return { x: 0, y: 0 };
  }

  const seed = createHash('sha1').update(`${room}|${requestId}|${text}`).digest('hex');
  const x = deterministicNumberFromHex(seed.slice(0, 8), -360, 360);
  const y = deterministicNumberFromHex(seed.slice(8, 16), -240, 240);
  return { x, y };
};

export async function runCanvasSteward(args: RunCanvasStewardArgs) {
  const { task, params } = args;
  const normalizedEntries = objectToEntries(params);
  const payload = jsonObjectSchema.parse(entriesToObject(normalizedEntries));
  const room = extractRoom(payload);
  const model = typeof payload.model === 'string' ? payload.model : undefined;
  const followupDepth = extractFollowupDepth(payload);
  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as JsonObject)
      : undefined;
  const contextProfile = normalizeFairyContextProfile(
    typeof payload.contextProfile === 'string'
      ? payload.contextProfile
      : metadata?.contextProfile,
  );
  const correlation = deriveRequestCorrelation({
    task,
    requestId: payload.requestId,
    params: payload,
  });

  const taskLabel = task.startsWith('canvas.') ? task.slice('canvas.'.length) : task;
  const start = Date.now();

  logWithTs('🚀 [CanvasSteward] run.start', {
    task,
    taskLabel,
    room,
    message: typeof payload.message === 'string' ? payload.message.slice(0, 100) : undefined,
  });

  try {
    if (task === 'canvas.quick_text') {
      const result = await handleQuickTextTask(room, payload);
      logWithTs('✅ [CanvasSteward] quick_text.complete', {
        task,
        room,
        durationMs: Date.now() - start,
        shapeId: result.shapeId,
      });
      return result;
    }

    if (task === 'canvas.quick_shapes') {
      const result = await handleQuickShapesTask(room, payload);
      logWithTs('✅ [CanvasSteward] quick_shapes.complete', {
        task,
        room,
        durationMs: Date.now() - start,
        actionCount: result.actionCount,
      });
      return result;
    }

    if (task === 'canvas.quick_apply_proof') {
      const requestId =
        typeof payload.requestId === 'string' && payload.requestId.trim().length > 0
          ? payload.requestId.trim()
          : randomUUID();
      return {
        status: 'applied',
        requestId,
        fastRouteType:
          typeof payload.fast_route_type === 'string' ? payload.fast_route_type : undefined,
        participantId:
          typeof payload.participant_id === 'string' ? payload.participant_id : undefined,
        appliedTargetId:
          typeof payload.applied_target_id === 'string' ? payload.applied_target_id : undefined,
        proof: 'quick_apply_ack',
      } as const;
    }

    const message = extractMessage(payload);
    const billingUserId =
      typeof payload.billingUserId === 'string' && payload.billingUserId.trim()
        ? payload.billingUserId.trim()
        : undefined;
    const provider = normalizeProvider(payload.provider) ?? inferProviderFromModel(model) ?? 'openai';
    const initialViewport = parseViewport(payload.bounds);
    const initialFollowup = extractInitialFollowup(payload, message, followupDepth);
    const invokeCanvasRunner = async () =>
      runCanvasAgent({
        roomId: room,
        userMessage: message,
        model,
        initialViewport,
        contextProfile,
        requestId: correlation.requestId,
        traceId: correlation.traceId,
        intentId: correlation.intentId,
        followupDepth,
        initialFollowup,
        metadata,
      });
    if (billingUserId && ['openai', 'anthropic', 'google'].includes(provider)) {
      const providerKey = await getDecryptedUserModelKey({
        userId: billingUserId,
        provider,
      });
      if (!providerKey) {
        throw new Error(`BYOK_MISSING_KEY:${provider}`);
      }
      const keyName =
        provider === 'openai'
          ? 'OPENAI_API_KEY'
          : provider === 'anthropic'
            ? 'ANTHROPIC_API_KEY'
            : 'GOOGLE_API_KEY';
      const runtimeKeys: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string; GOOGLE_API_KEY?: string } = {};
      runtimeKeys[keyName] = providerKey;
      await withRuntimeModelKeys(runtimeKeys, invokeCanvasRunner);
    } else {
      await invokeCanvasRunner();
    }

    logWithTs('✅ [CanvasSteward] run.complete', {
      task,
      room,
      durationMs: Date.now() - start,
    });

    return 'Canvas agent executed';
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    const graphFallbackMessage =
      typeof payload.message === 'string'
        ? payload.message
        : typeof payload.instruction === 'string'
          ? payload.instruction
          : typeof payload.text === 'string'
            ? payload.text
            : '';
    if (looksLikeGraphIntent(task, graphFallbackMessage)) {
      try {
        const fallbackRequestId = correlation.requestId ?? randomUUID();
        const fallbackPayload: JsonObject = {
          ...payload,
          requestId: fallbackRequestId,
          traceId: correlation.traceId ?? fallbackRequestId,
          intentId: correlation.intentId ?? fallbackRequestId,
          actions: buildGraphFallbackActions(
            graphFallbackMessage || 'graph request',
            payload,
            fallbackRequestId,
          ),
        };
        const fallbackResult = await handleQuickShapesTask(room, fallbackPayload);
        logWithTs('⚠️ [CanvasSteward] graph_fallback.applied', {
          task,
          room,
          durationMs: Date.now() - start,
          error: failureMessage.slice(0, 240),
          actionCount: fallbackResult.actionCount,
          status: fallbackResult.status,
        });
        return {
          status: fallbackResult.status,
          requestId: fallbackResult.requestId,
          actionCount: fallbackResult.actionCount,
          shapeIds: fallbackResult.shapeIds,
          degraded: true,
          fallback: 'graph_sketch',
          error: failureMessage.slice(0, 240),
        } as const;
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        logWithTs('❌ [CanvasSteward] graph_fallback.failed', {
          task,
          room,
          durationMs: Date.now() - start,
          error: failureMessage.slice(0, 240),
          fallbackError: fallbackMessage.slice(0, 240),
        });
        return {
          status: 'failed',
          requestId: correlation.requestId ?? randomUUID(),
          degraded: true,
          fallback: 'graph_sketch',
          error: `graph fallback failed: ${fallbackMessage}`.slice(0, 320),
        } as const;
      }
    }

    logWithTs('❌ [CanvasSteward] run.error', {
      task,
      room,
      error: failureMessage,
    });
    throw error;
  }
}

function extractRoom(payload: JsonObject): string {
  const raw = payload.room;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  throw new Error('Canvas steward requires a room parameter');
}

function extractMessage(payload: JsonObject): string {
  const raw = payload.message || payload.instruction || payload.text;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  throw new Error('Canvas steward requires a message parameter');
}

const looksLikeGraphIntent = (task: string, message: string): boolean => {
  if (!message.trim()) return false;
  if (task === 'canvas.quick_shapes' || task === 'canvas.quick_text') return false;
  return GRAPH_FALLBACK_PATTERN.test(message);
};

const extractEquationLabel = (message: string): string | null => {
  const match = message.match(GRAPH_EQUATION_PATTERN);
  if (!match?.[0]) return null;
  const normalized = match[0].replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, 80);
};

const buildGraphFallbackActions = (message: string, payload: JsonObject, requestId: string): AgentAction[] => {
  const deterministicSeed = createHash('sha1')
    .update(`${requestId}|${message}`)
    .digest('hex');
  const bounds = pickQuickTextPlacementBounds(payload) ?? { x: -360, y: -220, w: 720, h: 440 };
  const centerX = Math.round(bounds.x + bounds.w * 0.5);
  const centerY = Math.round(bounds.y + bounds.h * 0.5);
  const axisHalfWidth = Math.max(140, Math.min(420, Math.round(bounds.w * 0.42)));
  const axisHalfHeight = Math.max(120, Math.min(300, Math.round(bounds.h * 0.42)));
  const left = centerX - axisHalfWidth;
  const right = centerX + axisHalfWidth;
  const top = centerY - axisHalfHeight;
  const bottom = centerY + axisHalfHeight;
  const equation = extractEquationLabel(message);
  const graphLabel = equation
    ? `Sketch fallback (${equation})`
    : 'Sketch fallback (graph request)';

  return [
    {
      id: `graph-axis-x-${deterministicSeed.slice(0, 8)}`,
      name: 'create_shape',
      params: {
        id: `graph-axis-x-${deterministicSeed.slice(0, 8)}`,
        type: 'line',
        x: left,
        y: centerY,
        props: {
          startPoint: { x: left, y: centerY },
          endPoint: { x: right, y: centerY },
          color: 'grey',
          dash: 'dashed',
          size: 'm',
        },
      },
    },
    {
      id: `graph-axis-y-${deterministicSeed.slice(8, 16)}`,
      name: 'create_shape',
      params: {
        id: `graph-axis-y-${deterministicSeed.slice(8, 16)}`,
        type: 'line',
        x: centerX,
        y: top,
        props: {
          startPoint: { x: centerX, y: top },
          endPoint: { x: centerX, y: bottom },
          color: 'grey',
          dash: 'dashed',
          size: 'm',
        },
      },
    },
    {
      id: `graph-label-${deterministicSeed.slice(16, 24)}`,
      name: 'create_shape',
      params: {
        id: `graph-label-${deterministicSeed.slice(16, 24)}`,
        type: 'text',
        x: left,
        y: top - 36,
        props: {
          text: graphLabel,
          color: 'black',
          size: 'm',
        },
      },
    },
  ];
};

function extractQuickText(payload: JsonObject): string {
  const raw = payload.text || payload.message || payload.content || payload.label;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  throw new Error('canvas.quick_text requires text content');
}

const coerceDepth = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return undefined;
};

function extractFollowupDepth(payload: JsonObject): number {
  const direct = coerceDepth(payload.depth);
  if (typeof direct === 'number') return direct;

  const followup =
    payload.followup && typeof payload.followup === 'object' && !Array.isArray(payload.followup)
      ? (payload.followup as JsonObject)
      : undefined;
  const nested = coerceDepth(followup?.depth);
  if (typeof nested === 'number') return nested;

  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as JsonObject)
      : undefined;
  const metadataDepth = coerceDepth(metadata?.followupDepth);
  if (typeof metadataDepth === 'number') return metadataDepth;

  const metadataFollowup =
    metadata?.followup && typeof metadata.followup === 'object' && !Array.isArray(metadata.followup)
      ? (metadata.followup as JsonObject)
      : undefined;
  const metadataNested = coerceDepth(metadataFollowup?.depth);
  if (typeof metadataNested === 'number') return metadataNested;

  return 0;
}

function extractInitialFollowup(
  payload: JsonObject,
  defaultMessage: string,
  followupDepth: number,
): CanvasFollowupInput | undefined {
  const followup =
    payload.followup && typeof payload.followup === 'object' && !Array.isArray(payload.followup)
      ? (payload.followup as JsonObject)
      : undefined;
  if (!followup) return undefined;

  const message = typeof followup.message === 'string' && followup.message.trim().length > 0
    ? followup.message.trim()
    : defaultMessage;
  const originalMessage =
    typeof followup.originalMessage === 'string' && followup.originalMessage.trim().length > 0
      ? followup.originalMessage.trim()
      : defaultMessage;
  const depth = coerceDepth(followup.depth) ?? followupDepth;
  const initial: CanvasFollowupInput = { message, originalMessage, depth };

  if (typeof followup.hint === 'string' && followup.hint.trim().length > 0) {
    initial.hint = followup.hint.trim();
  }
  if (typeof followup.reason === 'string' && followup.reason.trim().length > 0) {
    initial.reason = followup.reason.trim();
  }
  if (followup.strict === true) {
    initial.strict = true;
  }
  if (Array.isArray(followup.targetIds)) {
    const targetIds = followup.targetIds.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    );
    if (targetIds.length > 0) {
      initial.targetIds = Array.from(new Set(targetIds));
    }
  }
  if (typeof followup.enqueuedAt === 'number' && Number.isFinite(followup.enqueuedAt)) {
    initial.enqueuedAt = followup.enqueuedAt;
  }

  return initial;
}

async function handleQuickTextTask(room: string, payload: JsonObject) {
  const text = extractQuickText(payload);
  const shapeType = normalizeQuickTextShapeType(payload.shapeType);
  const targetHint = resolveQuickTextTargetHint(payload);
  const requestId = typeof payload.requestId === 'string' && payload.requestId.trim().length > 0
    ? payload.requestId.trim()
    : randomUUID();
  const sessionId = `quick-text-${requestId}`;
  const deterministicSeed = createHash('sha1').update(`${room}|${requestId}|${text}`).digest('hex');
  const shapeId =
    typeof payload.shapeId === 'string' && payload.shapeId.trim().length > 0
      ? payload.shapeId.trim()
      : `qt_${deterministicSeed.slice(0, 12)}`;

  const { x, y } = resolveQuickTextPlacement(room, requestId, text, payload, targetHint);
  const props =
    shapeType === 'note'
      ? {
          text,
          color:
            typeof payload.color === 'string' && payload.color.trim().length > 0
              ? payload.color.trim()
              : 'yellow',
          size:
            typeof payload.size === 'string' && payload.size.trim().length > 0
              ? payload.size.trim()
              : 'm',
        }
      : {
          text,
        };

  const actions: AgentAction[] = [
    {
      id: `create-${deterministicSeed.slice(12, 24)}`,
      name: 'create_shape',
      params: {
        id: shapeId,
        type: shapeType,
        x,
        y,
        props,
      },
    },
  ];

  const traceId =
    typeof payload.traceId === 'string' && payload.traceId.trim().length > 0
      ? payload.traceId.trim()
      : requestId;
  const intentId =
    typeof payload.intentId === 'string' && payload.intentId.trim().length > 0
      ? payload.intentId.trim()
      : requestId;

  let ack: Awaited<ReturnType<typeof awaitAck>> = null;
  let envelopeHash: string | undefined;
  for (let attempt = 0; attempt < QUICK_TEXT_ACK_RETRIES; attempt += 1) {
    const sendResult = await sendActionsEnvelope(room, sessionId, 0, actions, {
      correlation: {
        traceId,
        intentId,
        requestId,
      },
    });
    envelopeHash = sendResult.hash;
    ack = await awaitAck({
      sessionId,
      seq: 0,
      deadlineMs: QUICK_TEXT_ACK_TIMEOUT_MS,
      expectedHash: sendResult.hash,
    });
    if (ack) break;
    if (attempt + 1 < QUICK_TEXT_ACK_RETRIES && QUICK_TEXT_ACK_RETRY_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, QUICK_TEXT_ACK_RETRY_DELAY_MS));
    }
  }

  if (!ack) {
    return {
      status: 'queued',
      requestId,
      shapeId,
      shapeType,
      targetHint,
      reason: 'apply_evidence_pending',
      ack: {
        clientId: null,
        latencyMs: null,
        envelopeHash: envelopeHash ?? null,
        pending: true,
        attempts: QUICK_TEXT_ACK_RETRIES,
      },
    } as const;
  }

  return {
    status: 'applied',
    requestId,
    shapeId,
    shapeType,
    targetHint,
    ack: {
      clientId: (ack as any).clientId ?? null,
      latencyMs:
        typeof (ack as any).latencyMs === 'number' && Number.isFinite((ack as any).latencyMs)
          ? (ack as any).latencyMs
          : null,
      envelopeHash:
        typeof (ack as any).envelopeHash === 'string' && (ack as any).envelopeHash.trim().length > 0
          ? (ack as any).envelopeHash
          : envelopeHash ?? null,
    },
  } as const;
}

function extractQuickShapeActions(payload: JsonObject): AgentAction[] {
  const rawActions = payload.actions;
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    throw new Error('canvas.quick_shapes requires actions[]');
  }

  const sanitizeQuickShapeAction = (
    name: AgentAction['name'],
    params: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (name === 'create_shape') {
      const next = { ...params };
      const rawType = typeof next.type === 'string' ? next.type : undefined;
      const resolvedType = resolveShapeType(rawType) ?? rawType;
      if (resolvedType) {
        next.type = resolvedType;
      }
      const rawProps =
        next.props && typeof next.props === 'object' && !Array.isArray(next.props)
          ? ({ ...(next.props as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      if (resolvedType) {
        next.props = sanitizeShapeProps(rawProps, resolvedType);
      } else {
        next.props = rawProps;
      }
      return next;
    }

    if (name === 'update_shape') {
      const next = { ...params };
      const rawProps =
        next.props && typeof next.props === 'object' && !Array.isArray(next.props)
          ? ({ ...(next.props as Record<string, unknown>) } as Record<string, unknown>)
          : {};
      const hintedType = typeof next.shapeType === 'string' ? resolveShapeType(next.shapeType) : undefined;
      const inferredType =
        hintedType ??
        (rawProps.points || rawProps.startPoint || rawProps.endPoint
          ? 'line'
          : rawProps.start || rawProps.end
            ? 'arrow'
            : undefined);
      if (inferredType) {
        next.props = sanitizeShapeProps(rawProps, inferredType);
      } else {
        next.props = rawProps;
      }
      return next;
    }

    return { ...params };
  };

  const parsed: AgentAction[] = [];
  for (let index = 0; index < rawActions.length; index += 1) {
    const candidate = rawActions[index];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const actionRecord = candidate as Record<string, unknown>;
    const params = readJsonObject(actionRecord.params);
    if (!params) continue;
    const name =
      typeof actionRecord.name === 'string' && actionRecord.name.trim().length > 0
        ? actionRecord.name.trim()
        : '';
    if (name !== 'create_shape' && name !== 'update_shape' && name !== 'delete_shape') continue;
    const id =
      typeof actionRecord.id === 'string' && actionRecord.id.trim().length > 0
        ? actionRecord.id.trim()
        : `quick-shape-${index + 1}`;
    const normalizedName = name as AgentAction['name'];
    const sanitizedParams = sanitizeQuickShapeAction(normalizedName, params);
    try {
      const validated = parseAction({
        id,
        name: normalizedName,
        params: sanitizedParams,
      });
      parsed.push({
        id: validated.id,
        name: validated.name,
        params: validated.params,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`canvas.quick_shapes action[${index}] invalid: ${reason}`);
    }
  }

  if (parsed.length === 0) {
    throw new Error('canvas.quick_shapes requires at least one valid action');
  }
  return parsed;
}

async function handleQuickShapesTask(room: string, payload: JsonObject) {
  const actions = extractQuickShapeActions(payload);
  const requestId =
    typeof payload.requestId === 'string' && payload.requestId.trim().length > 0
      ? payload.requestId.trim()
      : randomUUID();
  const traceId =
    typeof payload.traceId === 'string' && payload.traceId.trim().length > 0
      ? payload.traceId.trim()
      : requestId;
  const intentId =
    typeof payload.intentId === 'string' && payload.intentId.trim().length > 0
      ? payload.intentId.trim()
      : requestId;
  const sessionId = `quick-shapes-${requestId}`;

  let ack: Awaited<ReturnType<typeof awaitAck>> = null;
  let envelopeHash: string | undefined;
  for (let attempt = 0; attempt < QUICK_TEXT_ACK_RETRIES; attempt += 1) {
    const sendResult = await sendActionsEnvelope(room, sessionId, 0, actions, {
      correlation: {
        traceId,
        intentId,
        requestId,
      },
    });
    envelopeHash = sendResult.hash;
    ack = await awaitAck({
      sessionId,
      seq: 0,
      deadlineMs: QUICK_TEXT_ACK_TIMEOUT_MS,
      expectedHash: sendResult.hash,
    });
    if (ack) break;
    if (attempt + 1 < QUICK_TEXT_ACK_RETRIES && QUICK_TEXT_ACK_RETRY_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, QUICK_TEXT_ACK_RETRY_DELAY_MS));
    }
  }

  const shapeIds = actions
    .map((action) => {
      const params = action.params as Record<string, unknown> | undefined;
      return typeof params?.id === 'string' ? params.id : null;
    })
    .filter((id): id is string => Boolean(id && id.trim()));

  if (!ack) {
    return {
      status: 'queued',
      requestId,
      shapeIds,
      actionCount: actions.length,
      reason: 'apply_evidence_pending',
      ack: {
        clientId: null,
        latencyMs: null,
        envelopeHash: envelopeHash ?? null,
        pending: true,
        attempts: QUICK_TEXT_ACK_RETRIES,
      },
    } as const;
  }

  return {
    status: 'applied',
    requestId,
    shapeIds,
    actionCount: actions.length,
    ack: {
      clientId: (ack as any).clientId ?? null,
      latencyMs:
        typeof (ack as any).latencyMs === 'number' && Number.isFinite((ack as any).latencyMs)
          ? (ack as any).latencyMs
          : null,
      envelopeHash:
        typeof (ack as any).envelopeHash === 'string' && (ack as any).envelopeHash.trim().length > 0
          ? (ack as any).envelopeHash
          : envelopeHash ?? null,
    },
  } as const;
}


const entriesToObject = (entries: ParamEntryType[]) =>
  Object.fromEntries((entries ?? []).map(({ key, value }) => [key, value]));

const objectToEntries = (obj: JsonObject | ParamEntryType[] | undefined): ParamEntryType[] => {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj as ParamEntryType[];
  return Object.entries(obj)
    .filter(([, value]) => typeof value !== 'undefined')
    .map(([key, value]) => ParamEntry.parse({ key, value: value as JsonValue }));
};
