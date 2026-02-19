import { z } from 'zod';
import { randomUUID } from 'crypto';
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from '@/lib/utils/json-schema';
import { runCanvasAgent } from '@/lib/agents/canvas-agent/server/runner';
import type { CanvasFollowupInput } from '@/lib/agents/canvas-agent/server/followup-queue';
import { sendActionsEnvelope } from '@/lib/agents/canvas-agent/server/wire';
import type { AgentAction } from '@/lib/canvas-agent/contract/types';
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
    logWithTs('❌ [CanvasSteward] run.error', {
      task,
      room,
      error: error instanceof Error ? error.message : String(error),
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
  const requestId = typeof payload.requestId === 'string' && payload.requestId.trim().length > 0
    ? payload.requestId.trim()
    : randomUUID();
  const sessionId = `quick-text-${requestId}`;
  const normalizedRequestId = requestId.replace(/[^a-zA-Z0-9_-]/g, '');
  const shapeId =
    typeof payload.shapeId === 'string' && payload.shapeId.trim().length > 0
      ? payload.shapeId.trim()
      : `qt_${normalizedRequestId.slice(0, 24) || randomUUID().slice(0, 12)}`;

  const deterministicAnchor = (() => {
    const source = `${requestId}::${text}`.trim();
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
      hash = (hash * 31 + source.charCodeAt(i)) | 0;
    }
    const normalized = Math.abs(hash);
    const col = normalized % 9;
    const row = Math.floor(normalized / 9) % 7;
    return {
      x: (col - 4) * 140,
      y: (row - 3) * 110,
    };
  })();

  const viewportBounds = parseViewport(payload.bounds);
  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as JsonObject)
      : undefined;
  const metadataAnchor =
    metadata?.anchor && typeof metadata.anchor === 'object' && !Array.isArray(metadata.anchor)
      ? (metadata.anchor as Record<string, unknown>)
      : undefined;

  const anchorX = typeof metadataAnchor?.x === 'number' && Number.isFinite(metadataAnchor.x)
    ? metadataAnchor.x
    : undefined;
  const anchorY = typeof metadataAnchor?.y === 'number' && Number.isFinite(metadataAnchor.y)
    ? metadataAnchor.y
    : undefined;

  const x = typeof payload.x === 'number' && Number.isFinite(payload.x)
    ? payload.x
    : anchorX !== undefined
      ? anchorX
      : viewportBounds
        ? Math.round(viewportBounds.x + viewportBounds.w * 0.08)
        : deterministicAnchor.x;
  const y = typeof payload.y === 'number' && Number.isFinite(payload.y)
    ? payload.y
    : anchorY !== undefined
      ? anchorY
      : viewportBounds
        ? Math.round(viewportBounds.y + viewportBounds.h * 0.08)
        : deterministicAnchor.y;

  const actions: AgentAction[] = [
    {
      id: `create-${shapeId}`,
      name: 'create_shape',
      params: {
        id: shapeId,
        type: 'text',
        x,
        y,
        props: {
          text,
        },
      },
    },
  ];

  await sendActionsEnvelope(room, sessionId, 0, actions);

  return {
    status: 'ok',
    requestId,
    shapeId,
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
