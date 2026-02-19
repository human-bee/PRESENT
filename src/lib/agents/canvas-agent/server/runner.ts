import { randomUUID } from 'crypto';
import { selectModel } from './models';
import { buildPromptParts } from './context';
import { sanitizeActions } from './sanitize';
import { requestScreenshot, sendActionsEnvelope, sendChat, sendStatus, sendTrace, awaitAck } from './wire';
import { broadcastToolCall } from '@/lib/agents/shared/supabase-context';
import type { CanvasShapeSummary } from '@/lib/agents/shared/supabase-context';
import { ACTION_VERSION } from '@/lib/canvas-agent/contract/types';
import { OffsetManager, interpretBounds } from './offset';
import { handleStructuredStreaming } from './streaming';
import type { AgentAction } from '@/lib/canvas-agent/contract/types';
import { parseAction } from '@/lib/canvas-agent/contract/parsers';
import { SessionScheduler } from './scheduler';
import { addTodo, listTodos, type TodoItem as StoredTodoItem } from './todos';
import { getCanvasShapeSummary } from '@/lib/agents/shared/supabase-context';
import type { ScreenshotPayload } from '@/server/inboxes/screenshot';
import { getModelTuning } from './model/presets';
import type { CanvasAgentPreset } from './model/presets';
import { BRAND_PRESETS } from '@/lib/brand/brand-presets';
import { validateCanonicalAction } from '@/lib/canvas-agent/contract/tooling/catalog';
import { resolveShapeType, sanitizeShapeProps } from '@/lib/canvas-agent/contract/shape-utils';
import { CANVAS_AGENT_SYSTEM_PROMPT } from '@/lib/canvas-agent/contract/system-prompt';
import { loadCanvasAgentConfig, type CanvasAgentConfig } from './config';
import { convertTeacherAction } from '@/lib/canvas-agent/contract/teacher-bridge';
import type { TeacherPromptContext } from '@/lib/canvas-agent/teacher-runtime/prompt';
import { buildTeacherContextItems } from '@/lib/canvas-agent/teacher-runtime/context-items';
import { buildTeacherChatHistory, type TranscriptEntry } from '@/lib/canvas-agent/teacher-runtime/chat-history';
import {
  getTeacherRuntimeLastError,
  getTeacherServiceForEndpoint,
  type TeacherService,
} from '@/lib/canvas-agent/teacher-runtime/service-client';
import { normalizeFairyContextProfile, type FairyContextProfile } from '@/lib/fairy-context/profiles';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { enqueueCanvasFollowup, type CanvasFollowupInput } from './followup-queue';
import type { JsonObject } from '@/lib/utils/json-schema';
import {
  describeRetryError,
  isRetryableProviderError,
  parseRetryEnvInt,
} from '@/lib/agents/shared/provider-retry';

let teacherRuntimeWarningLogged = false;
let durableFollowupQueue: AgentTaskQueue | null | undefined;
let durableFollowupQueueWarningLogged = false;

const getDurableFollowupQueue = (): AgentTaskQueue | null => {
  if (durableFollowupQueue !== undefined) {
    return durableFollowupQueue;
  }
  try {
    durableFollowupQueue = new AgentTaskQueue();
  } catch (error) {
    durableFollowupQueue = null;
    if (!durableFollowupQueueWarningLogged) {
      durableFollowupQueueWarningLogged = true;
      console.warn('[CanvasAgent:Followups] durable queue unavailable, falling back to in-session scheduler', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return durableFollowupQueue;
};


export type CanvasAgentHooks = {
  onActions?: (payload: {
    roomId: string;
    sessionId: string;
    seq: number;
    partial: boolean;
    source: 'present' | 'teacher';
    actions: AgentAction[];
  }) => void;
};

type RunArgs = {
  roomId: string;
  userMessage: string;
  model?: string;
  initialViewport?: { x: number; y: number; w: number; h: number };
  hooks?: CanvasAgentHooks;
  contextProfile?: FairyContextProfile | string;
  requestId?: string;
  traceId?: string;
  intentId?: string;
  followupDepth?: number;
  initialFollowup?: CanvasFollowupInput;
  metadata?: JsonObject;
};

let screenshotInboxPromise: Promise<typeof import('@/server/inboxes/screenshot')> | null = null;

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const INVOKE_RETRY_ATTEMPTS = parseRetryEnvInt(process.env.CANVAS_AGENT_INVOKE_RETRY_ATTEMPTS, 3, {
  min: 1,
  max: 8,
});
const INVOKE_RETRY_BASE_DELAY_MS = parseRetryEnvInt(process.env.CANVAS_AGENT_INVOKE_RETRY_BASE_DELAY_MS, 300, {
  min: 0,
  max: 10_000,
});
const INVOKE_RETRY_MAX_DELAY_MS = parseRetryEnvInt(process.env.CANVAS_AGENT_INVOKE_RETRY_MAX_DELAY_MS, 4_000, {
  min: 1,
  max: 30_000,
});
const FOLLOWUP_INVOKE_RETRY_ATTEMPTS = parseRetryEnvInt(process.env.CANVAS_AGENT_FOLLOWUP_INVOKE_RETRY_ATTEMPTS, 3, {
  min: 1,
  max: 8,
});
const FOLLOWUP_INVOKE_RETRY_BASE_DELAY_MS = parseRetryEnvInt(process.env.CANVAS_AGENT_FOLLOWUP_INVOKE_RETRY_BASE_DELAY_MS, 400, {
  min: 0,
  max: 10_000,
});
const FOLLOWUP_INVOKE_RETRY_MAX_DELAY_MS = parseRetryEnvInt(process.env.CANVAS_AGENT_FOLLOWUP_INVOKE_RETRY_MAX_DELAY_MS, 5_000, {
  min: 1,
  max: 30_000,
});
const FOLLOWUP_LOOP_BASE_DELAY_MS = parseRetryEnvInt(process.env.CANVAS_AGENT_FOLLOWUP_LOOP_BASE_DELAY_MS, 300, {
  min: 0,
  max: 5_000,
});
const FOLLOWUP_LOOP_MAX_DELAY_MS = parseRetryEnvInt(process.env.CANVAS_AGENT_FOLLOWUP_LOOP_MAX_DELAY_MS, 2_500, {
  min: 1,
  max: 15_000,
});

const computeInvokeRetryDelayMs = (attempt: number) =>
  Math.min(
    INVOKE_RETRY_MAX_DELAY_MS,
    INVOKE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
const computeFollowupInvokeRetryDelayMs = (attempt: number) =>
  Math.min(
    FOLLOWUP_INVOKE_RETRY_MAX_DELAY_MS,
    FOLLOWUP_INVOKE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
const computeFollowupLoopDelayMs = (depth: number) =>
  Math.min(
    FOLLOWUP_LOOP_MAX_DELAY_MS,
    FOLLOWUP_LOOP_BASE_DELAY_MS * 2 ** Math.max(0, depth - 1),
  );

const parseTraceEventBudget = (): number => {
  const raw = process.env.CANVAS_AGENT_TRACE_MAX_EVENTS;
  if (typeof raw !== 'string' || raw.trim().length === 0) return 120;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(0, parsed);
};

const normalizeInitialFollowup = (
  input: CanvasFollowupInput | undefined,
  fallbackMessage: string,
  fallbackDepth: number,
): CanvasFollowupInput | null => {
  if (!input || typeof input !== 'object') return null;
  const message = typeof input.message === 'string' && input.message.trim().length > 0
    ? input.message.trim()
    : fallbackMessage;
  const originalMessage = typeof input.originalMessage === 'string' && input.originalMessage.trim().length > 0
    ? input.originalMessage.trim()
    : fallbackMessage;
  const depth = Number.isFinite(input.depth) ? Math.max(0, Math.floor(input.depth)) : fallbackDepth;
  const normalized: CanvasFollowupInput = {
    message,
    originalMessage,
    depth,
  };
  if (typeof input.hint === 'string' && input.hint.trim().length > 0) normalized.hint = input.hint.trim();
  if (typeof input.reason === 'string' && input.reason.trim().length > 0) normalized.reason = input.reason.trim();
  if (input.strict === true) normalized.strict = true;
  if (Array.isArray(input.targetIds)) {
    const targetIds = input.targetIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    if (targetIds.length > 0) {
      normalized.targetIds = Array.from(new Set(targetIds));
    }
  }
  if (typeof input.enqueuedAt === 'number' && Number.isFinite(input.enqueuedAt)) {
    normalized.enqueuedAt = input.enqueuedAt;
  }
  return normalized;
};

function loadScreenshotInbox() {
  if (!screenshotInboxPromise) {
    screenshotInboxPromise = import('@/server/inboxes/screenshot');
  }
  return screenshotInboxPromise;
}

const isPromptTooLongError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const direct = typeof (error as any)?.message === 'string' ? String((error as any).message).toLowerCase() : '';
  if (direct.includes('prompt is too long')) return true;
  const nested = typeof (error as any)?.data?.error?.message === 'string' ? String((error as any).data.error.message).toLowerCase() : '';
  return nested.includes('prompt is too long');
};

const BRAND_COLOR_ALIASES: Record<string, string> = {
  'brutalist-orange': 'orange',
  'brutalist orange': 'orange',
  'brutal-orange': 'orange',
  'brutal orange': 'orange',
  brutal: 'orange',
  'burnt-orange': 'orange',
  'burnt orange': 'orange',
  burnt: 'orange',
  burntorange: 'orange',
  'deep-orange': 'red',
  'deep orange': 'red',
  deep: 'red',
  deeporange: 'red',
  charcoal: 'black',
  ink: 'black',
  graphite: 'grey',
  smoke: 'grey',
  ash: 'grey',
  'accent-blue': 'blue',
  'accent blue': 'blue',
  'accent-green': 'green',
  'accent green': 'green',
  'accent-violet': 'violet',
  'accent violet': 'violet',
  citrus: 'yellow',
};

const resolveTranscriptWindowMs = (
  profile: FairyContextProfile | undefined,
  defaultMs: number,
) => {
  if (!profile) return defaultMs;
  if (profile === 'glance') return Math.min(defaultMs, 30_000);
  if (profile === 'deep') return Math.max(defaultMs, 180_000);
  if (profile === 'archive') return Math.max(defaultMs, 420_000);
  return defaultMs;
};

const sanitizeProps = (rawProps: Record<string, unknown>, shapeType: string) =>
  sanitizeShapeProps(rawProps, shapeType, { colorAliases: BRAND_COLOR_ALIASES });

const mapTodosToTeacherItems = (todos: StoredTodoItem[]) => {
  return todos
    .map((todo, index) => {
      const text = typeof todo.text === 'string' ? todo.text.trim() : '';
      if (!text) return null;
      const numericId = Number.isFinite(todo.position) ? Number(todo.position) : index;
      const status = todo.status === 'done' ? 'done' : 'todo';
      return {
        id: numericId,
        text,
        status,
      } as { id: number; text: string; status: 'todo' | 'in-progress' | 'done' };
    })
    .filter((item): item is { id: number; text: string; status: 'todo' | 'in-progress' | 'done' } => Boolean(item));
};

type BrandPresetName = keyof typeof BRAND_PRESETS;

const PRESET_SYNONYMS: Record<string, BrandPresetName> = {
  hero: 'Hero',
  headline: 'Hero',
  heading: 'Hero',
  title: 'Hero',
  callout: 'Callout',
  calloutbox: 'Callout',
  quiet: 'Quiet',
  subtle: 'Quiet',
  wire: 'Wire',
  wireframe: 'Wire',
  label: 'Label',
  tag: 'Label',
};

const resolvePresetName = (raw: unknown): BrandPresetName | undefined => {
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  const direct = Object.keys(BRAND_PRESETS).find((key) => key.toLowerCase() === normalized);
  if (direct) return direct as BrandPresetName;
  if (PRESET_SYNONYMS[normalized]) return PRESET_SYNONYMS[normalized];
  return undefined;
};

const coerceNumeric = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const expandMacroAction = (rawAction: Record<string, any>): Record<string, any>[] | null => {
  if (!rawAction || typeof rawAction !== 'object') return null;
  if (rawAction.name !== 'apply_preset') return null;
  const params = typeof rawAction.params === 'object' && rawAction.params !== null ? { ...(rawAction.params as Record<string, any>) } : {};
  const presetName = resolvePresetName(params.preset ?? params.name ?? params.style);
  if (!presetName) return [];
  const preset = BRAND_PRESETS[presetName];
  const targetIds = Array.isArray(params.targetIds)
    ? params.targetIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
    : [];
  const typeCandidate = resolveShapeType(params.shape ?? params.type ?? (targetIds.length === 0 ? 'note' : undefined));
  const resolvedType = typeCandidate ?? (targetIds.length > 0 ? 'note' : 'note');
  const overrides = typeof params.props === 'object' && params.props !== null ? params.props : {};
  const baseProps = sanitizeProps({ ...preset, ...overrides }, resolvedType);

  if (targetIds.length > 0) {
    return targetIds.map((targetId, index) => ({
      id: `${rawAction.id ?? `preset-${presetName}`}-${index}`,
      name: 'update_shape',
      params: { id: targetId, props: baseProps },
    }));
  }

  const x = coerceNumeric(params.x) ?? 0;
  const y = coerceNumeric(params.y) ?? 0;
  const w = coerceNumeric(params.w ?? params.width) ?? 240;
  const h = coerceNumeric(params.h ?? params.height) ?? 160;
  const text = typeof params.text === 'string' && params.text.trim().length > 0 ? params.text.trim() : presetName;
  const createId =
    typeof params.id === 'string' && params.id.trim().length > 0
      ? params.id.trim()
      : `preset-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;

  return [
    {
      id: rawAction.id ?? createId,
      name: 'create_shape',
      params: {
        id: createId,
        type: resolvedType,
        x,
        y,
        props: sanitizeProps({ ...baseProps, w, h, text }, resolvedType),
      },
    },
  ];
};

const _coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

type SessionMetrics = {
  sessionId: string;
  roomId: string;
  startedAt: number;
  contextBuiltAt?: number;
  modelCalledAt?: number;
  firstActionAt?: number;
  completedAt?: number;
  shapeCount?: number;
  transcriptLines?: number;
  imageBytes?: number;
  docVersion?: string;
  chunkCount: number;
  actionCount: number;
  mutatingActionCount: number;
  followupCount: number;
  retryCount: number;
  ttfb?: number;
  blurryCount?: number;
  peripheralCount?: number;
  tokenBudgetMax?: number;
  transcriptTokenEstimate?: number;
  firstAckLatencyMs?: number;
  screenshotRequestId?: string;
  screenshotRequestedAt?: number;
  screenshotReceivedAt?: number;
  screenshotTimeoutMs?: number;
  screenshotRtt?: number;
  screenshotResult?: 'received' | 'timeout' | 'error';
  preset?: string;
  selectedCount?: number;
  examplesCount?: number;
};

function logMetrics(
  metrics: SessionMetrics,
  cfg: CanvasAgentConfig,
  event: 'start' | 'context' | 'ttfb' | 'complete' | 'error' | 'screenshot',
  detail?: unknown,
) {
  if (!cfg.debug) return;
  const payload: Record<string, unknown> = { event, sessionId: metrics.sessionId, roomId: metrics.roomId, ts: Date.now() };
  if (metrics.preset) payload.preset = metrics.preset;
  if (event === 'ttfb' && metrics.ttfb !== undefined) {
    payload.ttfb = metrics.ttfb;
    payload.slo_met = metrics.ttfb <= cfg.ttfbSloMs;
    payload.slo_target = cfg.ttfbSloMs;
  }
  if (event === 'context') {
    if (metrics.blurryCount !== undefined) payload.blurry_count = metrics.blurryCount;
    if (metrics.peripheralCount !== undefined) payload.peripheral_count = metrics.peripheralCount;
    if (metrics.tokenBudgetMax !== undefined) payload.token_budget_max = metrics.tokenBudgetMax;
    if (metrics.transcriptTokenEstimate !== undefined) payload.transcript_tokens = metrics.transcriptTokenEstimate;
    if (metrics.selectedCount !== undefined) payload.selected_count = metrics.selectedCount;
    if (metrics.examplesCount !== undefined) payload.examples_count = metrics.examplesCount;
  }
  if (event === 'screenshot') {
    payload.request_id = metrics.screenshotRequestId;
    payload.timeout_ms = metrics.screenshotTimeoutMs;
    if (typeof metrics.imageBytes === 'number') payload.image_bytes = metrics.imageBytes;
    if (typeof metrics.screenshotRtt === 'number') payload.rtt = metrics.screenshotRtt;
    payload.result = metrics.screenshotResult ?? detail ?? 'unknown';
  }
  if (event === 'complete') {
    payload.duration = metrics.completedAt ? metrics.completedAt - metrics.startedAt : 0;
    payload.chunkCount = metrics.chunkCount;
    payload.actionCount = metrics.actionCount;
    payload.mutatingActionCount = metrics.mutatingActionCount;
    payload.followupCount = metrics.followupCount;
    payload.shapeCount = metrics.shapeCount;
    payload.transcriptLines = metrics.transcriptLines;
    payload.retryCount = metrics.retryCount;
    if (metrics.firstAckLatencyMs !== undefined) payload.first_ack_ms = metrics.firstAckLatencyMs;
    if (metrics.blurryCount !== undefined) payload.blurry_count = metrics.blurryCount;
    if (metrics.peripheralCount !== undefined) payload.peripheral_count = metrics.peripheralCount;
  }
  if (event === 'error') {
    payload.error = detail;
  }
  try { console.log('[CanvasAgent:Metrics]', JSON.stringify(payload)); } catch {}
}

export async function runCanvasAgent(args: RunArgs) {
  const { roomId, userMessage: rawUserMessage, model, hooks: hookOverrides } = args;
  const hooks = hookOverrides ?? {};
  const userMessage = rawUserMessage.trim().length > 0
    ? rawUserMessage.trim()
    : 'Improve the layout. Clarify hierarchy and polish typography.';
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestId =
    typeof args.requestId === 'string' && args.requestId.trim().length > 0 ? args.requestId.trim() : undefined;
  const traceId =
    typeof args.traceId === 'string' && args.traceId.trim().length > 0 ? args.traceId.trim() : requestId;
  const intentId =
    typeof args.intentId === 'string' && args.intentId.trim().length > 0 ? args.intentId.trim() : requestId;
  const correlation =
    traceId || intentId || requestId
      ? {
          ...(traceId ? { traceId } : {}),
          ...(intentId ? { intentId } : {}),
          ...(requestId ? { requestId } : {}),
        }
      : undefined;
  const currentFollowupDepth =
    typeof args.followupDepth === 'number' && Number.isFinite(args.followupDepth)
      ? Math.max(0, Math.floor(args.followupDepth))
      : 0;
  const initialFollowup = normalizeInitialFollowup(args.initialFollowup, userMessage, currentFollowupDepth);
  const runMetadata =
    args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata) ? args.metadata : undefined;
  const cfg = loadCanvasAgentConfig();
  if (cfg.mode === 'tldraw-teacher') {
    console.info('[CanvasAgent] running in tldraw-teacher mode (vendored TLDraw agent active)', {
      mode: cfg.mode,
      sessionId,
      roomId,
    });
  } else if (cfg.mode === 'shadow') {
    console.info('[CanvasAgent] running in shadow mode (present dispatch + teacher logging)', {
      mode: cfg.mode,
      sessionId,
      roomId,
    });
  }
  const scheduler = new SessionScheduler({ maxDepth: cfg.followups.maxDepth });
  const durableQueue = cfg.followups.durable ? getDurableFollowupQueue() : null;
  if (cfg.debug) {
    try {
      console.log('[CanvasAgent:FollowupsMode]', JSON.stringify({
        roomId,
        sessionId,
        depth: currentFollowupDepth,
        configuredDurable: cfg.followups.durable,
        activeMode: durableQueue ? 'durable-queue' : 'session-memory',
      }));
    } catch {}
  }
  const shapeTypeById = new Map<string, string>();
  const offset = new OffsetManager();
  const screenshotInbox = await loadScreenshotInbox();

  if (args.initialViewport) {
    const { x, y, w, h } = args.initialViewport;
    offset.setOrigin({ x: x + w / 2, y: y + h / 2 });
  }

  const metrics: SessionMetrics = {
    sessionId,
    roomId,
    startedAt: Date.now(),
    chunkCount: 0,
    actionCount: 0,
    mutatingActionCount: 0,
    followupCount: 0,
    retryCount: 0,
    preset: cfg.preset,
  };
  const traceEventBudget = parseTraceEventBudget();
  let traceEventsSent = 0;

  const emitTrace = (
    step:
      | 'run_start'
      | 'screenshot_requested'
      | 'screenshot_received'
      | 'screenshot_failed'
      | 'model_call'
      | 'model_retry'
      | 'chunk_processed'
      | 'actions_dispatched'
      | 'ack_received'
      | 'ack_timeout'
      | 'ack_retry'
      | 'followup_enqueued'
      | 'run_complete'
      | 'run_error',
    extras?: {
      seq?: number;
      partial?: boolean;
      actionCount?: number;
      detail?: Record<string, unknown>;
    },
  ) => {
    if (traceEventBudget <= 0) return;
    if (traceEventsSent >= traceEventBudget) return;
    if (step === 'chunk_processed' && extras?.partial && typeof extras.seq === 'number' && extras.seq % 5 !== 0) {
      return;
    }
    traceEventsSent += 1;
    void sendTrace(roomId, {
      sessionId,
      step,
      ...(correlation?.traceId ? { traceId: correlation.traceId } : {}),
      ...(correlation?.intentId ? { intentId: correlation.intentId } : {}),
      ...(correlation?.requestId ? { requestId: correlation.requestId } : {}),
      ...(typeof extras?.seq === 'number' ? { seq: extras.seq } : {}),
      ...(typeof extras?.partial === 'boolean' ? { partial: extras.partial } : {}),
      ...(typeof extras?.actionCount === 'number' ? { actionCount: extras.actionCount } : {}),
      ...(extras?.detail ? { detail: extras.detail } : {}),
    }).catch(() => {});
  };

  logMetrics(metrics, cfg, 'start');
  emitTrace('run_start', {
    detail: {
      mode: cfg.mode,
      followupDepth: currentFollowupDepth,
      followupsDurable: cfg.followups.durable && Boolean(durableQueue),
    },
  });

  let latestScreenshot: ScreenshotPayload | null = null;
  let screenshotEdge = cfg.screenshot.maxEdge;
  let lowActionRetryScheduled = false;
  let lastDispatchedChunk: {
    seq: number;
    actionNames: string[];
    partial: boolean;
    sample?: AgentAction;
  } | null = null;
  const _pendingViewportBounds: { x?: number; y?: number; w?: number; h?: number } | null = null;

  const captureScreenshot = async (
    label: 'primary' | 'followup',
    bounds?: { x: number; y: number; w: number; h: number },
    attempt = 0,
    maxEdge = cfg.screenshot.maxEdge,
  ): Promise<ScreenshotPayload | null> => {
    const requestId = randomUUID();
    metrics.screenshotRequestId = requestId;
    metrics.screenshotTimeoutMs = cfg.screenshot.timeoutMs;
    metrics.screenshotRequestedAt = Date.now();
    emitTrace('screenshot_requested', {
      detail: {
        label,
        attempt,
        requestId,
        timeoutMs: cfg.screenshot.timeoutMs,
      },
    });
    try {
      await requestScreenshot(roomId, {
        sessionId,
        requestId,
        bounds,
        maxSize: maxEdge ? { w: maxEdge, h: maxEdge } : undefined,
      });
    } catch (error) {
      metrics.screenshotResult = 'error';
      logMetrics(metrics, cfg, 'screenshot', `${label}:error`);
      emitTrace('screenshot_failed', {
        detail: {
          label,
          requestId,
          reason: 'request_error',
          error: error instanceof Error ? error.message : String(error),
          attempt,
        },
      });
      if (cfg.debug) {
        console.warn('[CanvasAgent:Screenshot]', `Request failed (${label})`, error);
      }
      if (attempt < cfg.screenshot.retries) {
        await delay(cfg.screenshot.retryDelayMs);
        return captureScreenshot(label, bounds, attempt + 1, maxEdge);
      }
      return null;
    }

    const timeoutAt = (metrics.screenshotRequestedAt ?? Date.now()) + cfg.screenshot.timeoutMs;
    while (Date.now() < timeoutAt) {
      const maybeScreenshot = screenshotInbox.takeScreenshot?.(sessionId, requestId) ?? null;
      if (maybeScreenshot) {
        metrics.screenshotReceivedAt = Date.now();
        metrics.imageBytes = maybeScreenshot.image?.bytes;
        if (typeof metrics.screenshotRequestedAt === 'number') {
          metrics.screenshotRtt = metrics.screenshotReceivedAt - metrics.screenshotRequestedAt;
        }
        metrics.screenshotResult = 'received';
        logMetrics(metrics, cfg, 'screenshot', `${label}:received`);
        emitTrace('screenshot_received', {
          detail: {
            label,
            requestId,
            bytes: maybeScreenshot.image?.bytes,
            rttMs: metrics.screenshotRtt,
          },
        });
        return maybeScreenshot;
      }
      await delay(20);
    }

    metrics.screenshotResult = 'timeout';
    logMetrics(metrics, cfg, 'screenshot', `${label}:timeout`);
    emitTrace('screenshot_failed', {
      detail: {
        label,
        requestId,
        reason: 'timeout',
        attempt,
      },
    });
    if (attempt < cfg.screenshot.retries) {
      if (cfg.debug) {
        console.warn('[CanvasAgent:Screenshot]', `Retrying ${label} capture (attempt ${attempt + 2})`);
      }
      await delay(cfg.screenshot.retryDelayMs);
      return captureScreenshot(label, bounds, attempt + 1, maxEdge);
    }
    return null;
  };

  const applyOffsetToActions = (actions: AgentAction[]): AgentAction[] => {
    return actions.map((action) => {
      const params = (action as any).params;
      if (!params || typeof params !== 'object') return action;
      const nextParams: Record<string, unknown> = { ...params };
      let mutated = false;
      if (typeof (nextParams as any).x === 'number' && typeof (nextParams as any).y === 'number') {
        const interpreted = offset.interpret({ x: Number((nextParams as any).x), y: Number((nextParams as any).y) });
        nextParams.x = interpreted.x;
        nextParams.y = interpreted.y;
        mutated = true;
      }
      const bounds = (nextParams as any).bounds;
      if (
        bounds &&
        typeof bounds.x === 'number' &&
        typeof bounds.y === 'number' &&
        typeof bounds.w === 'number' &&
        typeof bounds.h === 'number'
      ) {
        nextParams.bounds = interpretBounds(bounds, offset);
        mutated = true;
      }
      return mutated ? { ...action, params: nextParams } : action;
    });
  };

  const enforceShapeProps = (actions: AgentAction[]): AgentAction[] =>
    actions.map((action) => {
      if (action.name !== 'create_shape' && action.name !== 'update_shape') return action;
      const params = (action as any).params;
      if (!params || typeof params !== 'object') return action;
      const nextParams: Record<string, unknown> = { ...params };
      const targetId = typeof nextParams.id === 'string' ? nextParams.id.trim() : undefined;
      const explicitType = typeof nextParams.type === 'string' ? resolveShapeType(nextParams.type) : undefined;
      const inferredType = explicitType || (targetId ? shapeTypeById.get(targetId) : undefined);

      if (targetId && explicitType) {
        shapeTypeById.set(targetId, explicitType);
      }

      if (action.name === 'create_shape' && targetId && inferredType && !shapeTypeById.has(targetId)) {
        shapeTypeById.set(targetId, inferredType);
      }

      if (inferredType && typeof nextParams.props === 'object' && nextParams.props !== null) {
        const sanitized = sanitizeProps({ ...(nextParams.props as Record<string, unknown>) }, inferredType);
        if (Object.keys(sanitized).length > 0) nextParams.props = sanitized;
        else delete nextParams.props;
      }

      return { ...action, params: nextParams };
    });
  try {
    await sendStatus(roomId, sessionId, 'waiting_context');
    const screenshotRequestId = randomUUID();
    metrics.screenshotRequestId = screenshotRequestId;
    metrics.screenshotTimeoutMs = cfg.screenshot.timeoutMs;

    latestScreenshot = await captureScreenshot('primary', args.initialViewport, 0, screenshotEdge);
    if (!latestScreenshot && cfg.debug) {
      console.warn('[CanvasAgent:Screenshot]', `No screenshot available within ${cfg.screenshot.timeoutMs}ms; continuing without screenshot`);
    }

    const originViewport = latestScreenshot?.viewport ?? args.initialViewport;
    if (originViewport) {
      const { x, y, w, h } = originViewport;
      offset.setOrigin({ x: x + w / 2, y: y + h / 2 });
    }

    const normalizedProfile = normalizeFairyContextProfile(args.contextProfile);
    const transcriptWindowMs = resolveTranscriptWindowMs(normalizedProfile, cfg.transcriptWindowMs);

    const buildPromptPayload = async (
      label: 'initial' | 'downscale' | 'fallback' | 'noscreenshot',
    ): Promise<{ parts: Record<string, unknown>; prompt: string; buildMs: number }> => {
      const startedAt = Date.now();
      const parts = await buildPromptParts(roomId, {
        windowMs: transcriptWindowMs,
        viewport: latestScreenshot?.viewport ?? args.initialViewport,
        selection: initialFollowup?.targetIds ?? latestScreenshot?.selection ?? [],
        sessionId,
        screenshot: latestScreenshot
          ? {
              image: latestScreenshot.image,
              viewport: latestScreenshot.viewport,
              selection: latestScreenshot.selection,
              docVersion: latestScreenshot.docVersion,
              bounds: latestScreenshot.bounds,
              requestId: latestScreenshot.requestId,
              receivedAt: metrics.screenshotReceivedAt,
            }
          : undefined,
        offset,
      });
      const buildMs = Date.now() - startedAt;
      if (cfg.debug) {
        const screenshotBytes = (parts as any)?.screenshot?.bytes ?? metrics.imageBytes ?? 0;
        const selectedCount = Array.isArray((parts as any)?.selectedSimpleShapes)
          ? (parts as any).selectedSimpleShapes.length
          : 0;
        const blurryCount = Array.isArray((parts as any)?.blurryShapes) ? (parts as any).blurryShapes.length : 0;
        const peripheralCount = Array.isArray((parts as any)?.peripheralClusters)
          ? (parts as any).peripheralClusters.length
          : 0;
        console.log('[CanvasAgent:PromptParts]', JSON.stringify({
          sessionId,
          roomId,
          buildMs,
          label,
          blurryCount,
          peripheralCount,
          selectedCount,
          screenshotBytes,
        }));
      }
      const promptPayload: Record<string, unknown> = { user: userMessage, parts };
      if (initialFollowup) {
        promptPayload.followup = initialFollowup;
      }
      return { parts, prompt: JSON.stringify(promptPayload), buildMs };
    };

    const downscaleEdges = cfg.prompt.downscaleEdges;
    let downscaleCursor = 0;
    let promptPayload = await buildPromptPayload('initial');
    let promptLength = promptPayload.prompt.length;

    const applyPromptPayload = (payload: { parts: Record<string, unknown>; prompt: string; buildMs: number }) => {
      promptPayload = payload;
      promptLength = payload.prompt.length;
    };

    const attemptDownscaleEdge = async (reason: 'limit' | 'api_error'): Promise<boolean> => {
      if (!latestScreenshot) return false;
      while (downscaleCursor < downscaleEdges.length) {
        const nextEdge = downscaleEdges[downscaleCursor++];
        if (nextEdge >= screenshotEdge) continue;
        const smaller = await captureScreenshot('primary', args.initialViewport, 0, nextEdge);
        if (!smaller) continue;
        screenshotEdge = nextEdge;
        latestScreenshot = smaller;
        applyPromptPayload(await buildPromptPayload('downscale'));
        if (cfg.debug) {
          console.warn('[CanvasAgent:PromptTrim]', {
            sessionId,
            roomId,
            reason,
            promptChars: promptLength,
            limit: cfg.prompt.maxChars,
            edge: screenshotEdge,
          });
        }
        return true;
      }
      return false;
    };

    const reducePrompt = async (reason: 'limit' | 'api_error') => {
      let modified = false;
      if (reason === 'api_error' && latestScreenshot) {
        const trimmed = await attemptDownscaleEdge(reason);
        if (trimmed) {
          modified = true;
        }
      }
      while (promptLength > cfg.prompt.maxChars && latestScreenshot) {
        const trimmed = await attemptDownscaleEdge(reason);
        if (!trimmed) break;
        modified = true;
      }
      if (promptLength > cfg.prompt.maxChars && latestScreenshot) {
        latestScreenshot = null;
        applyPromptPayload(await buildPromptPayload('noscreenshot'));
        if (cfg.debug) {
          console.warn('[CanvasAgent:PromptTrim]', {
            sessionId,
            roomId,
            action: 'dropped_screenshot',
            reason,
            promptChars: promptLength,
            limit: cfg.prompt.maxChars,
          });
        }
        modified = true;
      }
      if (promptLength > cfg.prompt.maxChars && cfg.debug) {
        console.warn('[CanvasAgent:PromptTrim]', {
          sessionId,
          roomId,
          action: 'limit_exceeded',
          reason,
          promptChars: promptLength,
          limit: cfg.prompt.maxChars,
        });
      }
      return modified;
    };

    await reducePrompt('limit');

    let parts = promptPayload.parts;
    let prompt = promptPayload.prompt;
    const applyPromptMetadata = (currentParts: Record<string, unknown>) => {
      const budgetMeta = (currentParts as any).promptBudget;
      if (budgetMeta) {
        metrics.tokenBudgetMax = budgetMeta.maxTokens;
        metrics.transcriptTokenEstimate = budgetMeta.transcriptTokens;
        metrics.blurryCount = budgetMeta.blurryCount;
        metrics.peripheralCount = budgetMeta.peripheralCount;
        metrics.selectedCount = budgetMeta.selectedCount;
      }
      if (Array.isArray((currentParts as any)?.fewShotExamples)) {
        metrics.examplesCount = (currentParts as any).fewShotExamples.length;
      }
    };
    const recordContextMetrics = () => {
      metrics.shapeCount = (parts as any).shapes?.length || 0;
      metrics.transcriptLines = (parts as any).transcript?.length || 0;
      metrics.docVersion = (parts as any).docVersion;
      metrics.contextBuiltAt = Date.now();
      logMetrics(metrics, cfg, 'context');
    };

    applyPromptMetadata(parts);
    recordContextMetrics();

    await sendStatus(roomId, sessionId, 'calling_model');
    const requestedModel = model || cfg.modelName;
    const provider = selectModel(requestedModel);
    const primaryPresetName = (initialFollowup?.strict ? 'precise' : cfg.preset) as CanvasAgentPreset;
    const tuning = getModelTuning(primaryPresetName);
    if (cfg.debug) {
      try {
        console.log('[CanvasAgent:Model]', JSON.stringify({
          sessionId,
          roomId,
          requestedModel,
          provider: provider.name,
          streamingCapable: typeof provider.streamStructured === 'function',
          preset: primaryPresetName,
          tuning,
        }));
      } catch {}
    }
    let seq = 0;
    const sessionCreatedIds = new Set<string>();
    metrics.modelCalledAt = Date.now();

    const rememberCreatedIds = (actions: AgentAction[]) => {
      for (const action of actions) {
        if (action.name === 'create_shape') {
          const id = String((action as any).params?.id ?? '');
          if (id) sessionCreatedIds.add(id);
        }
        if (action.name === 'group') {
          const id = String((action as any).params?.groupId ?? '');
          if (id) sessionCreatedIds.add(id);
        }
      }
    };

    const enqueueFollowupTask = async (followup: CanvasFollowupInput): Promise<boolean> => {
      const normalizedDepth = Number.isFinite(followup.depth) ? Math.max(0, Math.floor(followup.depth)) : 0;
      if (normalizedDepth > cfg.followups.maxDepth) return false;

      if (durableQueue) {
        try {
          const accepted = await enqueueCanvasFollowup(
            {
              queue: durableQueue,
              roomId,
              sessionId,
              correlation,
              metadata: runMetadata,
              initialViewport: args.initialViewport,
            },
            { ...followup, depth: normalizedDepth },
          );
          if (accepted) {
            emitTrace('followup_enqueued', {
              detail: {
                mode: 'durable',
                depth: normalizedDepth,
                reason: followup.reason ?? null,
                strict: followup.strict === true,
              },
            });
            return true;
          }
        } catch (error) {
          console.warn('[CanvasAgent:Followups] durable follow-up enqueue failed', {
            roomId,
            sessionId,
            depth: normalizedDepth,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const fallbackInput: Record<string, unknown> = {
        message: followup.message,
        originalMessage: followup.originalMessage,
        depth: normalizedDepth,
        enqueuedAt: followup.enqueuedAt ?? Date.now(),
      };
      if (followup.hint) fallbackInput.hint = followup.hint;
      if (followup.reason) fallbackInput.reason = followup.reason;
      if (followup.strict) fallbackInput.strict = true;
      if (Array.isArray(followup.targetIds) && followup.targetIds.length > 0) {
        fallbackInput.targetIds = followup.targetIds;
      }
      const accepted = scheduler.enqueue(sessionId, { input: fallbackInput, depth: normalizedDepth });
      if (accepted) {
        emitTrace('followup_enqueued', {
          detail: {
            mode: 'session',
            depth: normalizedDepth,
            reason: followup.reason ?? null,
            strict: followup.strict === true,
          },
        });
      }
      return accepted;
    };

    const makeDetailEnqueuer =
      (baseMessage: string, baseDepth: number) => async (params: Record<string, unknown>): Promise<void> => {
        const hint = typeof params.hint === 'string' ? params.hint.trim() : '';
        const previousDepth = typeof params.depth === 'number' ? Number(params.depth) : baseDepth;
        const nextDepth = previousDepth + 1;
        if (nextDepth > cfg.followups.maxDepth) return;
        const targetIds = Array.isArray(params.targetIds)
          ? params.targetIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
          : [];
        const accepted = await enqueueFollowupTask({
          message: hint || baseMessage,
          originalMessage: baseMessage,
          depth: nextDepth,
          enqueuedAt: Date.now(),
          ...(hint ? { hint } : {}),
          ...(typeof params.reason === 'string' && params.reason.trim() ? { reason: params.reason.trim() } : {}),
          ...(params.strict === true ? { strict: true } : {}),
          ...(targetIds.length > 0 ? { targetIds } : {}),
        });
        if (accepted) metrics.followupCount++;
      };

/**
 * normalizeRawAction keeps create/update payloads in sync with the canonical
 * contract before we run schema validation. Most adjustments are structural
 * (moving props, coercing dimensions, resolving shape kinds). The lone
 * semantic fallback is the `line` → `rectangle` rewrite noted below, which is
 * a temporary crutch until the TLDraw contract exposes sized lines.
 */
const normalizeRawAction = (
  raw: unknown,
  shapeTypeById: Map<string, string>,
): Record<string, any> | null => {
  if (!raw || typeof raw !== 'object') return null;
  const action = raw as Record<string, any>;
  if (action.name !== 'create_shape' && action.name !== 'update_shape') return action;

  if (action.name === 'create_shape') {
    const params = typeof action.params === 'object' && action.params !== null ? { ...(action.params as Record<string, any>) } : {};
    const kindValue = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : undefined;
    const candidateType = typeof params.type === 'string' ? params.type : kindValue;
    let resolvedType = candidateType ? resolveShapeType(candidateType) : undefined;
    if (!resolvedType) {
      return null;
    }
    const hasDimension =
      coerceNumeric(params.w) !== undefined ||
      coerceNumeric(params.width) !== undefined ||
      coerceNumeric(params.h) !== undefined ||
      coerceNumeric(params.height) !== undefined;
    if (resolvedType === 'line' && hasDimension) {
      // Semantic rewrite: TLDraw's teacher can emit `line` shapes with width &
      // height, which PRESENT cannot render faithfully. For now we coerce
      // those into rectangles and document the hack so a parity pass can
      // remove it once prompts/examples converge.
      resolvedType = 'rectangle';
    }
    params.type = resolvedType;
    delete params.kind;

    const props = typeof params.props === 'object' && params.props !== null ? { ...(params.props as Record<string, any>) } : {};
    const moveToProps = (source: string, target?: string) => {
      if (!(source in params)) return;
      const value = params[source];
      if (value === undefined || value === null) {
        delete params[source];
        return;
      }
      if (typeof value === 'string' && value.trim().length === 0) {
        delete params[source];
        return;
      }
      props[target ?? source] = value;
      delete params[source];
    };

    const moveNumericToProps = (source: string, target?: string) => {
      const coerced = coerceNumeric(params[source]);
      if (coerced === undefined) {
        delete params[source];
        return;
      }
      props[target ?? source] = coerced;
      delete params[source];
    };

    moveNumericToProps('w');
    moveNumericToProps('width', 'w');
    moveNumericToProps('h');
    moveNumericToProps('height', 'h');
    moveNumericToProps('rx');
    moveNumericToProps('ry');
    moveToProps('text');
    moveToProps('label', 'text');
    moveToProps('font');
    moveToProps('size');
    moveToProps('color');
    moveToProps('fill');
    moveToProps('dash');

    if (Object.keys(props).length > 0) {
      const sanitized = sanitizeProps(props, params.type);
      if (Object.keys(sanitized).length > 0) {
        params.props = sanitized;
      } else {
        delete params.props;
      }
    } else {
      delete params.props;
    }

    if (typeof params.id === 'string' && params.id.trim().length > 0) {
      shapeTypeById.set(params.id.trim(), params.type);
    }

    return { ...action, params };
  }

  // update_shape sanitization relies on previously seen create_shape entries
  if (action.name === 'update_shape') {
    const params = typeof action.params === 'object' && action.params !== null ? { ...(action.params as Record<string, any>) } : {};
    const targetId = typeof params.id === 'string' ? params.id.trim() : '';
    if (!targetId) return null;
    let resolvedType = shapeTypeById.get(targetId);
    const candidateType = typeof params.type === 'string' ? resolveShapeType(params.type) : undefined;
    if (candidateType) {
      resolvedType = candidateType;
      shapeTypeById.set(targetId, candidateType);
      delete params.type;
    }
    if (typeof params.props === 'object' && params.props !== null) {
      const props = { ...(params.props as Record<string, unknown>) };
      const sanitized = resolvedType ? sanitizeProps(props, resolvedType) : sanitizeProps(props, 'note');
      if (Object.keys(sanitized).length > 0) params.props = sanitized;
      else delete params.props;
    }
    params.id = targetId;
    return { ...action, params };
  }

  return action;
};

    const processActions = async (
      rawActions: unknown,
      seqNumber: number,
      partial: boolean,
      enqueueDetail: (params: Record<string, unknown>) => Promise<void>,
      options?: { dispatch?: boolean; source?: 'present' | 'teacher' },
    ) => {
      const shouldDispatch = options?.dispatch !== false;
      const actionSource = options?.source ?? 'present';
      if (cfg.debug) {
        try {
          console.log('[CanvasAgent:ActionsChunk]', JSON.stringify({
            sessionId,
            roomId,
            seq: seqNumber,
            partial,
            rawCount: Array.isArray(rawActions) ? rawActions.length : 0,
            raw: rawActions,
          }));
        } catch {}
      }
      if (!Array.isArray(rawActions) || rawActions.length === 0) return 0;
      emitTrace('chunk_processed', {
        seq: seqNumber,
        partial,
        actionCount: rawActions.length,
        detail: { source: actionSource },
      });
      const parsed: AgentAction[] = [];
      const dropStats = {
        duplicateCreates: 0,
        invalidSchema: 0,
      };
      const queue: unknown[] = [];
      for (const candidate of rawActions) {
        const teacherConverted = convertTeacherAction(candidate);
        const baseCandidate = teacherConverted
          ? {
              id: typeof (candidate as any)?.id === 'string' ? (candidate as any).id : undefined,
              name: teacherConverted.name,
              params: teacherConverted.params,
            }
          : candidate;

        const macros = expandMacroAction(baseCandidate as Record<string, any>);
        if (Array.isArray(macros)) {
          if (macros.length > 0) {
            queue.push(...macros);
          }
          continue;
        }
        queue.push(baseCandidate);
      }

      const canvasSummary = await getCanvasShapeSummary(roomId);
      const existingShapeIds = new Set(canvasSummary.shapes.map((shape) => shape.id));
      for (const shape of canvasSummary.shapes) {
        if (!shape?.id || typeof shape.id !== 'string') continue;
        const normalizedType = resolveShapeType(shape.type);
        if (normalizedType) {
          shapeTypeById.set(shape.id, normalizedType);
        } else if (typeof shape.type === 'string' && shape.type.trim().length > 0) {
          shapeTypeById.set(shape.id, shape.type.trim());
        }
      }
      const chunkCreatedIds = new Set<string>();
      const knownIds = new Set<string>([
        ...existingShapeIds,
        ...sessionCreatedIds,
      ]);

      for (const item of queue) {
        const normalized = normalizeRawAction(item, shapeTypeById);
        if (!normalized) continue;
        if (normalized.name === 'create_shape') {
          const shapeId = String((normalized as any).params?.id ?? '').trim();
          if (shapeId) {
            if (knownIds.has(shapeId)) {
              // Structural dedupe: TLDraw occasionally repeats `create`
              // payloads. We drop the duplicates rather than mutating the
              // params so the dispatcher never sees conflicting shapes.
              dropStats.duplicateCreates++;
              continue;
            }
            knownIds.add(shapeId);
            chunkCreatedIds.add(shapeId);
          }
        }
        const schemaValidation = validateCanonicalAction(
          normalized as { id?: string | number; name: string; params: Record<string, unknown> },
        );
        if (!schemaValidation.ok) {
          dropStats.invalidSchema++;
          if (!partial) {
            console.warn('[CanvasAgent:SchemaGuard] Dropping invalid action', {
              roomId,
              sessionId,
              seq: seqNumber,
              name: (normalized as any)?.name,
              issues: schemaValidation.issues,
            });
          }
          continue;
        }
        try {
          parsed.push(
            parseAction({ id: String((normalized as any)?.id || `${Date.now()}`), name: (normalized as any)?.name, params: (normalized as any)?.params }),
          );
        } catch (parseError) {
          if (cfg.debug) {
            console.warn('[CanvasAgent:ParseActionError]', {
              roomId,
              sessionId,
              seq: seqNumber,
              action: (normalized as any)?.name,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
          }
        }
      }
      if (dropStats.duplicateCreates || dropStats.invalidSchema) {
        console.log(
          '[CanvasAgent:ActionDrops]',
          JSON.stringify({
            sessionId,
            roomId,
            seq: seqNumber,
            duplicateCreates: dropStats.duplicateCreates,
            invalidSchema: dropStats.invalidSchema,
          }),
        );
      }
      if (parsed.length === 0) {
        return 0;
      }
      const exists = (id: string) =>
        sessionCreatedIds.has(id) || chunkCreatedIds.has(id) || existingShapeIds.has(id);
      const clean = sanitizeActions(parsed, exists);
      if (shouldDispatch) {
        rememberCreatedIds(clean);
      }
      if (clean.length === 0) return 0;

      if (shouldDispatch && !metrics.firstActionAt && clean.length > 0) {
        metrics.firstActionAt = Date.now();
        metrics.ttfb = metrics.firstActionAt - metrics.startedAt;
        logMetrics(metrics, cfg, 'ttfb');
      }

      if (cfg.debug) {
        try {
          console.log('[CanvasAgent:ActionsRaw]', JSON.stringify({
            sessionId,
            roomId,
            seq: seqNumber,
            partial,
            actions: clean,
          }));
        } catch {}
      }

      const worldActions = applyOffsetToActions(enforceShapeProps(clean));
      if (worldActions.length === 0) return 0;

      const dispatchableActions = worldActions.filter((action) => action.name !== 'message');
      const mutatingActions = dispatchableActions.filter((action) => action.name !== 'think');
      const chatOnlyActions = worldActions.filter((action) => action.name === 'message');

      if (dispatchableActions.length > 0) {
        hooks.onActions?.({
          roomId,
          sessionId,
          seq: seqNumber,
          partial,
          source: actionSource,
          actions: dispatchableActions,
        });
        if (shouldDispatch) {
          metrics.actionCount += dispatchableActions.length;
          metrics.mutatingActionCount += mutatingActions.length;
          emitTrace('actions_dispatched', {
            seq: seqNumber,
            partial,
            actionCount: dispatchableActions.length,
            detail: {
              source: actionSource,
              verbs: dispatchableActions.slice(0, 8).map((action) => action.name),
            },
          });
          const firstSend = await sendActionsEnvelope(roomId, sessionId, seqNumber, dispatchableActions, {
            partial,
            correlation,
          });
          const ack = await awaitAck({
            sessionId,
            seq: seqNumber,
            deadlineMs: 1200,
            expectedHash: firstSend.hash,
          });
          if (ack && metrics.firstAckLatencyMs === undefined) {
            metrics.firstAckLatencyMs = Date.now() - metrics.startedAt;
          }
          if (ack) {
            emitTrace('ack_received', {
              seq: seqNumber,
              partial,
              actionCount: dispatchableActions.length,
            });
          }
          if (!ack) {
            emitTrace('ack_timeout', {
              seq: seqNumber,
              partial,
              actionCount: dispatchableActions.length,
            });
            metrics.retryCount++;
            emitTrace('ack_retry', {
              seq: seqNumber,
              partial,
              actionCount: dispatchableActions.length,
            });
            const retrySend = await sendActionsEnvelope(roomId, sessionId, seqNumber, dispatchableActions, {
              partial,
              correlation,
            });
            const retryAck = await awaitAck({
              sessionId,
              seq: seqNumber,
              deadlineMs: 800,
              expectedHash: retrySend.hash,
            });
            if (retryAck && metrics.firstAckLatencyMs === undefined) {
              metrics.firstAckLatencyMs = Date.now() - metrics.startedAt;
            }
            if (retryAck) {
              emitTrace('ack_received', {
                seq: seqNumber,
                partial,
                actionCount: dispatchableActions.length,
                detail: { retry: true },
              });
            } else {
              emitTrace('ack_timeout', {
                seq: seqNumber,
                partial,
                actionCount: dispatchableActions.length,
                detail: { retry: true },
              });
            }
          }
        }
      }

      if (shouldDispatch) {
        for (const action of [...dispatchableActions, ...chatOnlyActions]) {
          if (action.name === 'think') {
            const thought = String((action as any).params?.text || '');
            if (thought) {
              try {
                await sendChat(roomId, sessionId, { role: 'assistant', text: thought });
              } catch (chatError) {
                console.warn('[CanvasAgent:ThinkChatError]', {
                  roomId,
                  sessionId,
                  error: chatError instanceof Error ? chatError.message : chatError,
                });
              }
            }
          }
          if (action.name === 'todo') {
            const text = String((action as any).params?.text || '');
            if (text) {
              try {
                await addTodo(sessionId, text);
              } catch (todoError) {
                console.warn('[CanvasAgent:TodoError]', {
                  roomId,
                  sessionId,
                  error: todoError instanceof Error ? todoError.message : todoError,
                });
              }
            }
          }
          if (action.name === 'add_detail') {
            await enqueueDetail(((action as any).params ?? {}) as Record<string, unknown>);
          }
          if (action.name === 'message') {
            const text = String((action as any).params?.text || '').trim();
            if (text) {
              await sendChat(roomId, sessionId, { role: 'assistant', text });
            }
          }
        }
      }

      if (dispatchableActions.length > 0) {
        lastDispatchedChunk = {
          seq: seqNumber,
          actionNames: dispatchableActions.map((action) => action.name),
          partial,
          sample: dispatchableActions[0],
        };
      }

      return dispatchableActions.length;
    };

    await sendStatus(roomId, sessionId, 'streaming');
    const streamingEnabled = typeof provider.streamStructured === 'function' && process.env.CANVAS_AGENT_STREAMING !== 'false';
    const enqueueDetail = makeDetailEnqueuer(userMessage, currentFollowupDepth);

    if (cfg.debug) {
      try {
        console.log('[CanvasAgent:StreamingMode]', JSON.stringify({
          sessionId,
          roomId,
          streamingEnabled,
          provider: provider.name,
        }));
      } catch {}
    }

    const teacherModeRequested = cfg.mode !== 'present';
    let teacherRunner: ((dispatchActions: boolean) => Promise<void>) | null = null;
    let teacherServicePromise: Promise<TeacherService | null> | null = null;
    const loadTeacherService = async () => {
      if (!teacherServicePromise) {
        teacherServicePromise = getTeacherServiceForEndpoint(cfg.teacherEndpoint);
      }
      return teacherServicePromise;
    };

    if (teacherModeRequested) {
      const shapesForTeacher = Array.isArray((parts as any)?.shapes)
        ? ((parts as any).shapes as CanvasShapeSummary[])
        : [];
      const selectedForTeacher = Array.isArray((parts as any)?.selectedSimpleShapes)
        ? ((parts as any).selectedSimpleShapes as Array<Record<string, unknown>>)
        : [];

      const teacherContext: TeacherPromptContext = {
        userMessages: [userMessage],
        requestType: 'user',
        screenshotDataUrl:
          latestScreenshot?.image?.dataUrl ||
          (typeof (promptPayload.parts as any)?.screenshot?.dataUrl === 'string'
            ? ((promptPayload.parts as any).screenshot as { dataUrl: string }).dataUrl
            : null),
        bounds: (latestScreenshot?.viewport ?? args.initialViewport) || null,
        viewport: (latestScreenshot?.viewport ?? args.initialViewport) || null,
        styleInstructions:
          typeof (promptPayload.parts as any)?.styleInstructions === 'string'
            ? ((promptPayload.parts as any).styleInstructions as string)
            : undefined,
        promptBudget:
          typeof (promptPayload.parts as any)?.promptBudget === 'object'
            ? ((promptPayload.parts as any).promptBudget as Record<string, unknown>)
            : null,
        modelName: model ?? cfg.modelName,
        timestamp: new Date().toISOString(),
      };

      const teacherContextItems = buildTeacherContextItems({
        shapes: shapesForTeacher,
        selectedShapes: selectedForTeacher,
        viewport: teacherContext.viewport ?? teacherContext.bounds ?? null,
      });
      if (teacherContextItems.length > 0) {
        teacherContext.contextItems = teacherContextItems;
      }

      const transcriptForTeacher: TranscriptEntry[] = Array.isArray((parts as any)?.transcript)
        ? ((parts as any).transcript as TranscriptEntry[])
        : [];
      const teacherChatHistory = buildTeacherChatHistory({ transcript: transcriptForTeacher });
      if (teacherChatHistory && teacherChatHistory.length > 0) {
        teacherContext.chatHistory = teacherChatHistory;
      }

      try {
        const existingTodos = await listTodos(sessionId);
        const teacherTodoItems = mapTodosToTeacherItems(existingTodos);
        if (teacherTodoItems.length > 0) {
          teacherContext.todoItems = teacherTodoItems;
        }
      } catch (todoLoadError) {
        console.warn('[CanvasAgent:TodosUnavailable]', {
          roomId,
          sessionId,
          source: 'teacher-context',
          error: todoLoadError instanceof Error ? todoLoadError.message : todoLoadError,
        });
      }

      teacherRunner = async (dispatchActions: boolean) => {
        const service = await loadTeacherService();
        if (!service) {
          if (!teacherRuntimeWarningLogged) {
            console.warn('[CanvasAgent:TeacherRuntimeUnavailable]', {
              roomId,
              sessionId,
              mode: cfg.mode,
              reason:
                getTeacherRuntimeLastError() ??
                (cfg.teacherEndpoint ? 'teacher endpoint unavailable' : 'module import failed'),
            });
            teacherRuntimeWarningLogged = true;
          }
          return;
        }
        const streamStartedAt = Date.now();
        let seqTeacher = 1;
        let firstPartialLogged = false;
        for await (const event of service.stream(teacherContext, { dispatchActions })) {
          if (!firstPartialLogged) {
            firstPartialLogged = true;
            if (cfg.debug) {
              console.log('[CanvasAgent:FirstPartial]', JSON.stringify({
                sessionId,
                roomId,
                ms: Date.now() - streamStartedAt,
                source: 'teacher',
                dispatch: dispatchActions,
              }));
            }
          }
          if (dispatchActions) {
            metrics.chunkCount++;
          }
          if (!event?.complete) continue;
          const currentSeq = seqTeacher++;
          await processActions([event], currentSeq, false, enqueueDetail, {
            dispatch: dispatchActions,
            source: 'teacher',
          });
        }
      };
    }

    let shadowTeacherPromise: Promise<void> | null = null;

    if (cfg.mode === 'tldraw-teacher') {
      if (!teacherRunner) {
        console.warn('[CanvasAgent:TeacherModeDisabled]', {
          roomId,
          sessionId,
          reason:
            getTeacherRuntimeLastError() ??
            (cfg.teacherEndpoint ? 'teacher endpoint unavailable' : 'teacher runtime not available in this environment'),
        });
        return;
      }
      await teacherRunner(true);
      return;
    }

    if (cfg.mode === 'shadow' && teacherRunner) {
      shadowTeacherPromise = teacherRunner(false).catch((error) => {
        console.warn('[CanvasAgent:ShadowTeacherError]', {
          roomId,
          sessionId,
          error: error instanceof Error ? error.message : error,
        });
      });
    } else if (cfg.mode === 'shadow' && !teacherRunner) {
      console.warn('[CanvasAgent:ShadowTeacherDisabled]', {
        roomId,
        sessionId,
        reason:
          getTeacherRuntimeLastError() ??
          (cfg.teacherEndpoint ? 'teacher endpoint unavailable' : 'teacher runtime not available in this environment'),
      });
    }

    const invokeModel = async () => {
      emitTrace('model_call', {
        detail: {
          provider: provider.name,
          mode: streamingEnabled ? 'structured' : 'fallback-stream',
          preset: primaryPresetName,
        },
      });
      if (streamingEnabled) {
        const streamStartedAt = Date.now();
        let firstPartialLogged = false;
        if (cfg.debug) {
          try {
            console.log('[CanvasAgent:ModelCall]', JSON.stringify({
              sessionId,
              roomId,
              provider: provider.name,
              mode: 'structured',
            }));
          } catch {}
        }
        const structured = await provider.streamStructured?.(prompt, {
          system: CANVAS_AGENT_SYSTEM_PROMPT,
          tuning,
        });
        if (!structured && cfg.debug) {
          try {
            console.log('[CanvasAgent:ModelCall]', JSON.stringify({
              sessionId,
              roomId,
              provider: provider.name,
              mode: 'structured',
              result: 'no-structured-stream',
            }));
          } catch {}
        }
        if (structured) {
          let rawProcessed = 0;
          await handleStructuredStreaming(
            structured,
            async (delta) => {
              if (!Array.isArray(delta) || delta.length === 0) return;
              if (!firstPartialLogged) {
                firstPartialLogged = true;
                if (cfg.debug) {
                  console.log('[CanvasAgent:FirstPartial]', JSON.stringify({
                    sessionId,
                    roomId,
                    ms: Date.now() - streamStartedAt,
                  }));
                }
              }
              metrics.chunkCount++;
              const currentSeq = seq++;
              await processActions(delta, currentSeq, true, enqueueDetail);
              rawProcessed += delta.length;
            },
            async (finalActions) => {
              if (!Array.isArray(finalActions) || finalActions.length === 0) return;
              const pending = finalActions.slice(rawProcessed);
              rawProcessed = finalActions.length;
              if (pending.length === 0) return;
              const currentSeq = seq++;
              await processActions(pending, currentSeq, false, enqueueDetail);
            },
          );
        }
        return;
      }
      const streamStartedAt = Date.now();
      let firstPartialLogged = false;
      if (cfg.debug) {
        try {
          console.log('[CanvasAgent:ModelCall]', JSON.stringify({
            sessionId,
            roomId,
            provider: provider.name,
            mode: 'fallback-stream',
          }));
        } catch {}
      }
      for await (const chunk of provider.stream(prompt, { system: CANVAS_AGENT_SYSTEM_PROMPT, tuning })) {
        if (chunk.type !== 'json') continue;
        const actionsRaw = (chunk.data as any)?.actions;
        if (!Array.isArray(actionsRaw) || actionsRaw.length === 0) continue;
        if (!firstPartialLogged) {
          firstPartialLogged = true;
          if (cfg.debug) {
            console.log('[CanvasAgent:FirstPartial]', JSON.stringify({
              sessionId,
              roomId,
              ms: Date.now() - streamStartedAt,
            }));
          }
        }
        metrics.chunkCount++;
        const currentSeq = seq++;
        await processActions(actionsRaw, currentSeq, true, enqueueDetail);
      }
    };

    let invokeRetryAttempt = 0;
    while (true) {
      try {
        await invokeModel();
        break;
      } catch (error) {
        if (isPromptTooLongError(error)) {
          const trimmed = await reducePrompt('api_error');
          if (trimmed) {
            parts = promptPayload.parts;
            prompt = promptPayload.prompt;
            applyPromptMetadata(parts);
            recordContextMetrics();
            continue;
          }
        }
        if (isRetryableProviderError(error)) {
          invokeRetryAttempt += 1;
          const canRetry = invokeRetryAttempt < INVOKE_RETRY_ATTEMPTS;
          if (canRetry) {
            const delayMs = computeInvokeRetryDelayMs(invokeRetryAttempt);
            emitTrace('model_retry', {
              detail: {
                attempt: invokeRetryAttempt,
                maxAttempts: INVOKE_RETRY_ATTEMPTS,
                delayMs,
                reason: describeRetryError(error),
              },
            });
            if (cfg.debug) {
              try {
                console.warn('[CanvasAgent:ModelCall] transient provider failure, retrying', {
                  roomId,
                  sessionId,
                  attempt: invokeRetryAttempt,
                  maxAttempts: INVOKE_RETRY_ATTEMPTS,
                  delayMs,
                  error: describeRetryError(error),
                });
              } catch {}
            }
            await delay(delayMs);
            continue;
          }
        }
        throw error;
      }
    }

    if (
      !lowActionRetryScheduled &&
      cfg.followups.lowActionThreshold > 0 &&
      metrics.mutatingActionCount < cfg.followups.lowActionThreshold
    ) {
      const retryHint =
        'Add more layout detail: ensure there is a headline block, supporting shapes, and three sticky notes with copy ideas.';
      const enqueued = await enqueueFollowupTask({
        message: `${userMessage}\n\nFocus on finishing the layout, not narration.`,
        originalMessage: userMessage,
        hint: retryHint,
        strict: true,
        reason: 'low_action',
        depth: currentFollowupDepth + 1,
        enqueuedAt: Date.now(),
      });
      lowActionRetryScheduled = enqueued;
      if (enqueued) metrics.followupCount++;
      if (enqueued && cfg.debug) {
        console.log('[CanvasAgent] Scheduled low-action follow-up', {
          roomId,
          sessionId,
          threshold: cfg.followups.lowActionThreshold,
        });
      }
    }

    let next = scheduler.dequeue(sessionId);
    let loops = 0;
    while (next && loops < cfg.followups.maxDepth) {
      loops++;
      const followInputRaw = (next.input || {}) as Record<string, unknown>;
      const followInput = { ...followInputRaw };
      const followEnqueuedAt =
        typeof (followInput as any).enqueuedAt === 'number' && Number.isFinite((followInput as any).enqueuedAt)
          ? Number((followInput as any).enqueuedAt)
          : Date.now();
      const requiredFollowupDelayMs = computeFollowupLoopDelayMs(loops);
      const elapsedSinceFollowupEnqueueMs = Date.now() - followEnqueuedAt;
      if (requiredFollowupDelayMs > elapsedSinceFollowupEnqueueMs) {
        await delay(requiredFollowupDelayMs - elapsedSinceFollowupEnqueueMs);
      }
      const followTargetIds = Array.isArray((followInput as any).targetIds)
        ? (followInput as any).targetIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : [];
      const followMessageRaw = typeof (followInput as any).message === 'string' ? (followInput as any).message : undefined;
      const followMessage = followMessageRaw && followMessageRaw.trim().length > 0 ? followMessageRaw : userMessage;
      const followBaseDepth =
        typeof (followInput as any).depth === 'number'
          ? Number((followInput as any).depth)
          : next.depth ?? currentFollowupDepth + loops;

      let followScreenshot: ScreenshotPayload | null = null;
      const followBounds = latestScreenshot?.bounds ?? latestScreenshot?.viewport ?? args.initialViewport;
      if (followBounds) {
        followScreenshot = await captureScreenshot('followup', followBounds, 0, screenshotEdge);
      }

      if (followScreenshot) {
        latestScreenshot = followScreenshot;
        const { x, y, w, h } = followScreenshot.viewport;
        offset.setOrigin({ x: x + w / 2, y: y + h / 2 });
      }

      await sendStatus(roomId, sessionId, 'scheduled');
      const followParts = await buildPromptParts(roomId, {
        windowMs: transcriptWindowMs,
        viewport: followScreenshot?.viewport ?? args.initialViewport,
        selection: followTargetIds.length > 0 ? followTargetIds : followScreenshot?.selection ?? [],
        sessionId,
        screenshot: followScreenshot
          ? {
              image: followScreenshot.image,
              viewport: followScreenshot.viewport,
              selection: followScreenshot.selection,
              docVersion: followScreenshot.docVersion,
              bounds: followScreenshot.bounds,
              requestId: followScreenshot.requestId,
              receivedAt: metrics.screenshotReceivedAt,
            }
          : undefined,
        offset,
      });

      const followBudget = (followParts as any).promptBudget;
      if (followBudget) {
        metrics.tokenBudgetMax = followBudget.maxTokens;
        metrics.transcriptTokenEstimate = followBudget.transcriptTokens;
        metrics.blurryCount = followBudget.blurryCount;
        metrics.peripheralCount = followBudget.peripheralCount;
      }
      metrics.transcriptLines = (followParts as any).transcript?.length ?? metrics.transcriptLines;
      metrics.shapeCount = (followParts as any).shapes?.length ?? metrics.shapeCount;
      metrics.docVersion = (followParts as any).docVersion ?? metrics.docVersion;

      const followPayload: Record<string, unknown> = { user: followMessage, parts: followParts };
      if (Object.keys(followInput).length > 0) {
        followPayload.followup = followInput;
      }
      const followPrompt = JSON.stringify(followPayload);
      const followProvider = selectModel(model || cfg.modelName);
      let followSeq = 0;
      const followEnqueueDetail = makeDetailEnqueuer(followMessage, followBaseDepth);
      const followStreamingEnabled = typeof followProvider.streamStructured === 'function' && process.env.CANVAS_AGENT_STREAMING !== 'false';
      const followPresetName = (followInput.strict ? 'precise' : cfg.preset) as CanvasAgentPreset;
      const followTuning = getModelTuning(followPresetName);
      emitTrace('model_call', {
        detail: {
          provider: followProvider.name,
          mode: followStreamingEnabled ? 'structured' : 'fallback-stream',
          preset: followPresetName,
          phase: 'followup',
          depth: followBaseDepth,
        },
      });

      const invokeFollowModel = async () => {
        if (followStreamingEnabled) {
          const structuredFollow = await followProvider.streamStructured?.(followPrompt, {
            system: CANVAS_AGENT_SYSTEM_PROMPT,
            tuning: followTuning,
          });
          if (structuredFollow) {
            let followRawProcessed = 0;
            await handleStructuredStreaming(
              structuredFollow,
              async (delta) => {
                if (!Array.isArray(delta) || delta.length === 0) return;
                metrics.chunkCount++;
                const currentSeq = followSeq++;
                await processActions(delta, currentSeq, true, followEnqueueDetail);
                followRawProcessed += delta.length;
              },
              async (finalActions) => {
                if (!Array.isArray(finalActions) || finalActions.length === 0) return;
                const pending = finalActions.slice(followRawProcessed);
                followRawProcessed = finalActions.length;
                if (pending.length === 0) return;
                const currentSeq = followSeq++;
                await processActions(pending, currentSeq, false, followEnqueueDetail);
              },
            );
          }
          return;
        }
        for await (const chunk of followProvider.stream(followPrompt, { system: CANVAS_AGENT_SYSTEM_PROMPT, tuning: followTuning })) {
          if (chunk.type !== 'json') continue;
          const actionsRaw = (chunk.data as any)?.actions;
          if (!Array.isArray(actionsRaw) || actionsRaw.length === 0) continue;
          metrics.chunkCount++;
          const currentSeq = followSeq++;
          await processActions(actionsRaw, currentSeq, true, followEnqueueDetail);
        }
      };

      let followInvokeRetryAttempt = 0;
      while (true) {
        try {
          await invokeFollowModel();
          break;
        } catch (error) {
          if (isRetryableProviderError(error)) {
            followInvokeRetryAttempt += 1;
            const canRetry = followInvokeRetryAttempt < FOLLOWUP_INVOKE_RETRY_ATTEMPTS;
            if (canRetry) {
              const delayMs = computeFollowupInvokeRetryDelayMs(followInvokeRetryAttempt);
              emitTrace('model_retry', {
                detail: {
                  phase: 'followup',
                  depth: followBaseDepth,
                  attempt: followInvokeRetryAttempt,
                  maxAttempts: FOLLOWUP_INVOKE_RETRY_ATTEMPTS,
                  delayMs,
                  reason: describeRetryError(error),
                },
              });
              if (cfg.debug) {
                try {
                  console.warn('[CanvasAgent:FollowupModelCall] transient provider failure, retrying', {
                    roomId,
                    sessionId,
                    depth: followBaseDepth,
                    attempt: followInvokeRetryAttempt,
                    maxAttempts: FOLLOWUP_INVOKE_RETRY_ATTEMPTS,
                    delayMs,
                    error: describeRetryError(error),
                  });
                } catch {}
              }
              await delay(delayMs);
              continue;
            }
          }
          throw error;
        }
      }
      next = scheduler.dequeue(sessionId);
    }

    // Guarantee at least one visible action for simple create prompts if the model emitted nothing.
    if (metrics.actionCount === 0) {
      const fallbackId = `rect-${Date.now().toString(36)}`;
      const fallback = [
        {
          id: fallbackId,
          name: 'create_shape' as const,
          params: {
            id: fallbackId,
            type: 'rectangle',
            x: 0,
            y: 0,
            props: { w: 280, h: 180, dash: 'dotted', size: 'm', color: 'red', fill: 'none', font: 'mono' },
          },
        },
        {
          id: `vp-${Date.now().toString(36)}`,
          name: 'set_viewport' as const,
          params: { bounds: { x: -140, y: -90, w: 560, h: 360 } },
        },
      ];
      const currentSeq = seq++;
      let envelopeDispatched = false;
      try {
        emitTrace('actions_dispatched', {
          seq: currentSeq,
          partial: false,
          actionCount: fallback.length,
          detail: { source: 'fallback', verbs: fallback.map((action) => action.name) },
        });
        const firstSend = await sendActionsEnvelope(roomId, sessionId, currentSeq, fallback, { correlation });
        envelopeDispatched = true;
        const ack = await awaitAck({
          sessionId,
          seq: currentSeq,
          deadlineMs: 1200,
          expectedHash: firstSend.hash,
        });
        if (ack) {
          emitTrace('ack_received', {
            seq: currentSeq,
            partial: false,
            actionCount: fallback.length,
            detail: { source: 'fallback' },
          });
        }
        if (!ack) {
          emitTrace('ack_timeout', {
            seq: currentSeq,
            partial: false,
            actionCount: fallback.length,
            detail: { source: 'fallback' },
          });
          const retrySend = await sendActionsEnvelope(roomId, sessionId, currentSeq, fallback, { correlation });
          emitTrace('ack_retry', {
            seq: currentSeq,
            partial: false,
            actionCount: fallback.length,
            detail: { source: 'fallback' },
          });
          const retryAck = await awaitAck({
            sessionId,
            seq: currentSeq,
            deadlineMs: 800,
            expectedHash: retrySend.hash,
          });
          if (retryAck) {
            emitTrace('ack_received', {
              seq: currentSeq,
              partial: false,
              actionCount: fallback.length,
              detail: { source: 'fallback', retry: true },
            });
          } else {
            emitTrace('ack_timeout', {
              seq: currentSeq,
              partial: false,
              actionCount: fallback.length,
              detail: { source: 'fallback', retry: true },
            });
          }
        }
      } catch (error) {
        console.warn('[CanvasAgent] fallback envelope send failed', {
          roomId,
          sessionId,
          seq: currentSeq,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      metrics.actionCount += fallback.length;
      // Also broadcast as a tool_call so clients that don’t listen for agent:action still apply it (or when LiveKit send fails).
      try {
        await broadcastToolCall({
          room: roomId,
          tool: 'tldraw_envelope',
          params: {
            envelope: {
              v: ACTION_VERSION,
              sessionId,
              seq: currentSeq,
              actions: fallback as any,
              ts: Date.now(),
            } as any,
            source: envelopeDispatched ? 'livekit' : 'broadcast-only',
          },
        });
      } catch (error) {
        console.warn('[CanvasAgent] fallback envelope broadcast failed', {
          roomId,
          sessionId,
          seq: currentSeq,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await sendStatus(roomId, sessionId, 'done');

    metrics.completedAt = Date.now();
    logMetrics(metrics, cfg, 'complete');
    emitTrace('run_complete', {
      detail: {
        durationMs: metrics.completedAt - metrics.startedAt,
        actionCount: metrics.actionCount,
        followupCount: metrics.followupCount,
        retries: metrics.retryCount,
      },
    });
    if (shadowTeacherPromise) {
      await shadowTeacherPromise;
    }
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
    console.error('[CanvasAgent] run failed', {
      roomId,
      sessionId,
      detail,
      stack: error instanceof Error ? error.stack : undefined,
      lastDispatchedChunk,
    });
    metrics.completedAt = Date.now();
    logMetrics(metrics, cfg, 'error', detail);
    emitTrace('run_error', {
      detail: {
        error: detail,
      },
    });
    await sendStatus(roomId, sessionId, 'error', detail);
    throw error;
  }
}
