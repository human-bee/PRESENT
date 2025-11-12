import { randomUUID } from 'crypto';
import { selectModel } from './models';
import { buildPromptParts } from './context';
import { sanitizeActions } from './sanitize';
import { requestScreenshot, sendActionsEnvelope, sendChat, sendStatus, awaitAck } from './wire';
import { broadcastToolCall } from '@/lib/agents/shared/supabase-context';
import { ACTION_VERSION } from '../shared/types';
import { OffsetManager, interpretBounds } from './offset';
import { handleStructuredStreaming } from './streaming';
import type { AgentAction } from '../shared/types';
import { parseAction } from '../shared/parsers';
import { SessionScheduler } from './scheduler';
import { addTodo } from './todos';
import { getCanvasShapeSummary } from '@/lib/agents/shared/supabase-context';
import type { ScreenshotPayload } from '@/server/inboxes/screenshot';
import { getModelTuning, resolvePreset, resolveFollowupDepth } from './model/presets';


type RunArgs = { roomId: string; userMessage: string; model?: string; initialViewport?: { x: number; y: number; w: number; h: number } };

const DEFAULT_SCREENSHOT_TIMEOUT_MS = 3500;
const MIN_SCREENSHOT_TIMEOUT_MS = 2500;
let screenshotInboxPromise: Promise<typeof import('@/server/inboxes/screenshot')> | null = null;

function loadScreenshotInbox() {
  if (!screenshotInboxPromise) {
    screenshotInboxPromise = import('@/server/inboxes/screenshot');
  }
  return screenshotInboxPromise;
}

const coerceScreenshotTimeout = (value?: string): number => {
  const parsed = value ? Number.parseInt(value, 10) : DEFAULT_SCREENSHOT_TIMEOUT_MS;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SCREENSHOT_TIMEOUT_MS;
  }
  return Math.max(parsed, MIN_SCREENSHOT_TIMEOUT_MS);
};

const CANVAS_AGENT_SYSTEM_PROMPT = `You are the Canvas Agent for a TLDraw-based board with brand styling.

Goal
- Execute drawing, editing, styling, and layout commands by emitting TLDraw-native actions.
- Prefer doing over narrating. If a placement detail is missing, make a reasonable assumption and act.

Available actions
- create_shape · update_shape · delete_shape · draw_pen
- move · resize · rotate · group · ungroup
- align · distribute · stack · reorder · set_viewport
- think · todo · add_detail (sparingly)

Action format
- Always return JSON with an "actions" array. Each action has { id, name, params }.

Brand defaults (for next created shapes)
- font: mono, size: m, dash: dotted, color: red (mapped to deep orange).
- Selection & hover colors are orange (handled by CSS); no action required.

Style macros (interpret user phrases and apply via update_shape props)
- Macros: Hero, Callout, Quiet, Wire, Label.
- Mapping to TLDraw props (color keys follow TLDraw's palette names):
  • Hero   → { font: 'mono', size: 'xl', dash: 'solid',  color: 'red',   fill: 'none' }
  • Callout→ { font: 'mono', size: 'm',  dash: 'dotted', color: 'yellow',fill: 'semi' }
  • Quiet  → { font: 'sans', size: 's',  dash: 'solid',  color: 'grey',  fill: 'none' }
  • Wire   → { font: 'mono', size: 'm',  dash: 'solid',  color: 'grey',  fill: 'none' }
  • Label  → { font: 'mono', size: 's',  dash: 'solid',  color: 'red',   fill: 'solid' }

Macro behavior
- If shapes are selected, apply macro styles to the selection with a single update_shape per shape (coalesce props).
- If nothing is selected and the user invokes a macro (e.g. “create a Hero note”), create_shape with those props.
- Synonyms: "quiet" (Quiet), "wireframe"/"wire" (Wire), "tag" (Label), "callout" (Callout), "headline/hero" (Hero).

Layout & alignment
- When asked to align/stack/distribute, use 8px base spacing and prefer 32px rhythm offsets.

General rules
- Be creative but minimal: fewer, well-formed actions beat many small mutations.
- Keep color names within TLDraw keys (red/yellow/blue/green/violet/grey/black).
- For text, set { props: { text } } and convert to richText if needed later.
`;

const TL_COLOR_KEYS = new Set([
  'black',
  'grey',
  'light-violet',
  'violet',
  'blue',
  'light-blue',
  'yellow',
  'orange',
  'green',
  'light-green',
  'light-red',
  'red',
  'white',
]);

const BRAND_COLOR_MAP: Record<string, string> = {
  'brutalist-orange': 'orange',
  'brutal-orange': 'orange',
  'burnt-orange': 'orange',
  'burntorange': 'orange',
  'deep-orange': 'red',
  'deeporange': 'red',
  'charcoal': 'black',
  'ink': 'black',
  'graphite': 'grey',
  'smoke': 'grey',
  'ash': 'grey',
  'accent-blue': 'blue',
  'accent-green': 'green',
  'accent-violet': 'violet',
  'citrus': 'yellow',
};

const TL_FILL_KEYS = new Set(['none', 'solid', 'semi', 'pattern']);
const FILL_SYNONYMS: Record<string, string> = {
  transparent: 'none',
  hollow: 'none',
  outline: 'none',
  filled: 'solid',
  solid: 'solid',
  semi: 'semi',
  'semi-solid': 'semi',
  pattern: 'pattern',
};

const TL_DASH_KEYS = new Set(['solid', 'dashed', 'dotted']);
const DASH_SYNONYMS: Record<string, string> = {
  dash: 'dashed',
  dashed: 'dashed',
  dot: 'dotted',
  dotted: 'dotted',
  solid: 'solid',
  outline: 'solid',
};

const TL_FONT_KEYS = new Set(['mono', 'sans', 'serif']);
const FONT_SYNONYMS: Record<string, string> = {
  monospace: 'mono',
  monospaced: 'mono',
  mono: 'mono',
  'sans-serif': 'sans',
  sansserif: 'sans',
  sans: 'sans',
  serif: 'serif',
};

const TL_SIZE_KEYS = new Set(['xs', 's', 'm', 'l', 'xl']);
const SIZE_SYNONYMS: Record<string, string> = {
  xsmall: 'xs',
  xs: 'xs',
  small: 's',
  s: 's',
  medium: 'm',
  md: 'm',
  m: 'm',
  large: 'l',
  lg: 'l',
  l: 'l',
  xl: 'xl',
  'x-large': 'xl',
  headline: 'xl',
};

const normalizeEnumValue = (value: unknown, allowed: Set<string>, aliases: Record<string, string>): string | undefined => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (allowed.has(normalized)) return normalized;
    if (aliases[normalized]) return aliases[normalized];
  }
  return undefined;
};

const resolveColorName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TL_COLOR_KEYS.has(normalized)) return normalized;
  if (BRAND_COLOR_MAP[normalized]) return BRAND_COLOR_MAP[normalized];
  if (normalized.startsWith('burnt-') || normalized.startsWith('burntorange')) return 'orange';
  if (normalized.startsWith('deep-')) return 'red';
  return undefined;
};

const stripUnsupportedProps = (props: Record<string, unknown>, shapeType: string) => {
  if (shapeType === 'text') {
    delete props.dash;
    delete props.fill;
    delete props.strokeWidth;
  }
  return props;
};

const sanitizeProps = (rawProps: Record<string, unknown>, shapeType: string) => {
  const next: Record<string, unknown> = { ...rawProps };

  const color = resolveColorName(next.color ?? next.stroke ?? next.strokeColor);
  if (color) next.color = color;
  else delete next.color;

  const fill = normalizeEnumValue(next.fill, TL_FILL_KEYS, FILL_SYNONYMS);
  if (fill) next.fill = fill;
  else delete next.fill;

  const dash = normalizeEnumValue(next.dash ?? next.strokeStyle, TL_DASH_KEYS, DASH_SYNONYMS);
  if (dash) next.dash = dash;
  else delete next.dash;

  const font = normalizeEnumValue(next.font, TL_FONT_KEYS, FONT_SYNONYMS);
  if (font) next.font = font;
  else delete next.font;

  const size = normalizeEnumValue(next.size, TL_SIZE_KEYS, SIZE_SYNONYMS);
  if (size) next.size = size;
  else delete next.size;

  if (typeof next.text === 'string' && next.text.trim().length === 0) {
    delete next.text;
  }

  return stripUnsupportedProps(next, shapeType);
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

function getEnvConfig() {
  const env = process.env;
  const preset = resolvePreset(env);
  return {
    modelName: env.CANVAS_STEWARD_MODEL,
    debug: env.CANVAS_STEWARD_DEBUG === 'true',
    screenshotTimeoutMs: coerceScreenshotTimeout(env.CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS),
    ttfbSloMs: Number(env.CANVAS_AGENT_TTFB_SLO_MS ?? 200),
    clientEnabled: env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED === 'true',
    maxFollowups: resolveFollowupDepth(env, preset),
    preset,
  } as const;
}

function logMetrics(metrics: SessionMetrics, event: 'start' | 'context' | 'ttfb' | 'complete' | 'error' | 'screenshot', detail?: unknown) {
  const cfg = getEnvConfig();
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
  const { roomId, userMessage, model } = args;
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cfg = getEnvConfig();
  const scheduler = new SessionScheduler({ maxDepth: cfg.maxFollowups });
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
    followupCount: 0,
    retryCount: 0,
    preset: cfg.preset,
  };

  logMetrics(metrics, 'start');

  let latestScreenshot: ScreenshotPayload | null = null;

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
      if (action.name === 'draw_pen' && Array.isArray((nextParams as any).points)) {
        const points = (nextParams as any).points.map((point: any) => {
          if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return point;
          const interpreted = offset.interpret({ x: Number(point.x), y: Number(point.y) });
          return { ...point, x: interpreted.x, y: interpreted.y };
        });
        nextParams.points = points;
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
  try {
    await sendStatus(roomId, sessionId, 'waiting_context');
    const screenshotRequestId = randomUUID();
    metrics.screenshotRequestId = screenshotRequestId;
    metrics.screenshotTimeoutMs = cfg.screenshotTimeoutMs;

    try {
      metrics.screenshotRequestedAt = Date.now();
      await requestScreenshot(roomId, {
        sessionId,
        requestId: screenshotRequestId,
        bounds: args.initialViewport,
      });

      const timeoutAt = metrics.screenshotRequestedAt + cfg.screenshotTimeoutMs;
      while (Date.now() < timeoutAt) {
        const maybeScreenshot = screenshotInbox.takeScreenshot?.(sessionId, screenshotRequestId) ?? null;
        if (maybeScreenshot) {
          latestScreenshot = maybeScreenshot;
          metrics.screenshotReceivedAt = Date.now();
          metrics.imageBytes = maybeScreenshot.image?.bytes;
          if (typeof metrics.screenshotRequestedAt === 'number') {
            metrics.screenshotRtt = metrics.screenshotReceivedAt - metrics.screenshotRequestedAt;
          }
          metrics.screenshotResult = 'received';
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      if (!latestScreenshot) {
        metrics.screenshotResult = 'timeout';
      }
    } catch (screenshotError) {
      metrics.screenshotResult = 'error';
      if (cfg.debug) {
        console.warn('[CanvasAgent:Screenshot]', 'Failed to orchestrate screenshot', screenshotError);
      }
    } finally {
      logMetrics(metrics, 'screenshot', latestScreenshot ? 'received' : metrics.screenshotResult ?? 'none');
    }

    if (!latestScreenshot && cfg.debug) {
      console.warn('[CanvasAgent:Screenshot]', `No screenshot available within ${cfg.screenshotTimeoutMs}ms; continuing without screenshot`);
    }

    const originViewport = latestScreenshot?.viewport ?? args.initialViewport;
    if (originViewport) {
      const { x, y, w, h } = originViewport;
      offset.setOrigin({ x: x + w / 2, y: y + h / 2 });
    }

    const partsBuildStartedAt = Date.now();
    const parts = await buildPromptParts(roomId, {
      windowMs: 60000,
      viewport: latestScreenshot?.viewport ?? args.initialViewport,
      selection: latestScreenshot?.selection ?? [],
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
    const partsBuildMs = Date.now() - partsBuildStartedAt;
    const budgetMeta = (parts as any).promptBudget;
    if (budgetMeta) {
      metrics.tokenBudgetMax = budgetMeta.maxTokens;
      metrics.transcriptTokenEstimate = budgetMeta.transcriptTokens;
      metrics.blurryCount = budgetMeta.blurryCount;
      metrics.peripheralCount = budgetMeta.peripheralCount;
      metrics.selectedCount = budgetMeta.selectedCount;
    }
    if (Array.isArray((parts as any)?.fewShotExamples)) {
      metrics.examplesCount = (parts as any).fewShotExamples.length;
    }
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
        buildMs: partsBuildMs,
        blurryCount,
        peripheralCount,
        selectedCount,
        screenshotBytes,
      }));
    }
    const prompt = JSON.stringify({ user: userMessage, parts });

    metrics.contextBuiltAt = Date.now();
    metrics.shapeCount = (parts as any).shapes?.length || 0;
    metrics.transcriptLines = (parts as any).transcript?.length || 0;
    metrics.docVersion = (parts as any).docVersion;
    logMetrics(metrics, 'context');

    await sendStatus(roomId, sessionId, 'calling_model');
    const requestedModel = model || cfg.modelName;
    const provider = selectModel(requestedModel);
    const tuning = getModelTuning(cfg.preset);
    if (cfg.debug) {
      try {
        console.log('[CanvasAgent:Model]', JSON.stringify({
          sessionId,
          roomId,
          requestedModel,
          provider: provider.name,
          streamingCapable: typeof provider.streamStructured === 'function',
          preset: cfg.preset,
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
        if (action.name === 'draw_pen') {
          const id = String((action as any).params?.id ?? '');
          if (id) sessionCreatedIds.add(id);
        }
        if (action.name === 'group') {
          const id = String((action as any).params?.groupId ?? '');
          if (id) sessionCreatedIds.add(id);
        }
      }
    };

    const makeDetailEnqueuer = (baseMessage: string, baseDepth: number) => (params: Record<string, unknown>) => {
      const hint = typeof params.hint === 'string' ? params.hint.trim() : '';
      const previousDepth = typeof params.depth === 'number' ? Number(params.depth) : baseDepth;
      const nextDepth = previousDepth + 1;
      if (nextDepth > cfg.maxFollowups) return;
      const detailInput: Record<string, unknown> = {
        message: hint || baseMessage,
        originalMessage: baseMessage,
        depth: nextDepth,
        enqueuedAt: Date.now(),
      };
      if (hint) detailInput.hint = hint;
      const targetIds = Array.isArray(params.targetIds)
        ? params.targetIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : [];
      if (targetIds.length > 0) detailInput.targetIds = targetIds;
      const accepted = scheduler.enqueue(sessionId, { input: detailInput, depth: nextDepth });
      if (accepted) metrics.followupCount++;
    };

const TL_SHAPE_TYPES = new Set([
  'note',
  'text',
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'draw',
  'highlight',
  'frame',
  'group',
  'star',
  'cloud',
]);

const SHAPE_TYPE_SYNONYMS: Record<string, string> = {
  box: 'note',
  sticky: 'note',
  sticky_note: 'note',
  card: 'note',
  hero: 'text',
  headline: 'text',
  caption: 'text',
  rect: 'rectangle',
  square: 'rectangle',
  circle: 'ellipse',
  oval: 'ellipse',
  connector: 'arrow',
  arrowhead: 'arrow',
  wire: 'line',
};

const resolveShapeType = (value?: string): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (TL_SHAPE_TYPES.has(normalized)) return normalized;
  if (SHAPE_TYPE_SYNONYMS[normalized]) return SHAPE_TYPE_SYNONYMS[normalized];
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

    const normalizeRawAction = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return raw;
      const action = raw as Record<string, any>;
      if (action.name !== 'create_shape') return action;
      const params = typeof action.params === 'object' && action.params !== null ? { ...(action.params as Record<string, any>) } : {};
      const kindValue = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : undefined;
      if (!params.type && kindValue) {
        params.type = SHAPE_TYPE_SYNONYMS[kindValue] || kindValue;
      }
      delete params.kind;

      if (typeof params.type === 'string') {
        const resolvedType = resolveShapeType(params.type);
        if (resolvedType) {
          params.type = resolvedType;
        } else {
          return null; // Skip partial/unknown types until the model finishes emitting them
        }
      } else {
        return null;
      }

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

      return { ...action, params };
    };

    const processActions = async (
      rawActions: unknown,
      seqNumber: number,
      partial: boolean,
      enqueueDetail: (params: Record<string, unknown>) => void,
    ) => {
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
      const parsed: AgentAction[] = [];
      for (const a of rawActions) {
        const normalized = normalizeRawAction(a);
        if (!normalized) continue;
        try {
          parsed.push(parseAction({ id: String((normalized as any)?.id || `${Date.now()}`), name: (normalized as any)?.name, params: (normalized as any)?.params }));
        } catch {}
      }
      if (parsed.length === 0) return 0;
      const canvas = await getCanvasShapeSummary(roomId);
      const exists = (id: string) => sessionCreatedIds.has(id) || canvas.shapes.some((s) => s.id === id);
      const clean = sanitizeActions(parsed, exists);
      rememberCreatedIds(clean);
      if (clean.length === 0) return 0;

      if (!metrics.firstActionAt && clean.length > 0) {
        metrics.firstActionAt = Date.now();
        metrics.ttfb = metrics.firstActionAt - metrics.startedAt;
        logMetrics(metrics, 'ttfb');
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

      const worldActions = applyOffsetToActions(clean);
      if (worldActions.length === 0) return 0;

      metrics.actionCount += worldActions.length;
      await sendActionsEnvelope(roomId, sessionId, seqNumber, worldActions, { partial });
      const ack = await awaitAck({ sessionId, seq: seqNumber, deadlineMs: 1200 });
      if (ack && metrics.firstAckLatencyMs === undefined) {
        metrics.firstAckLatencyMs = Date.now() - metrics.startedAt;
      }
      if (!ack) {
        metrics.retryCount++;
        await sendActionsEnvelope(roomId, sessionId, seqNumber, worldActions, { partial });
        const retryAck = await awaitAck({ sessionId, seq: seqNumber, deadlineMs: 800 });
        if (retryAck && metrics.firstAckLatencyMs === undefined) {
          metrics.firstAckLatencyMs = Date.now() - metrics.startedAt;
        }
      }

      for (const action of worldActions) {
        if (action.name === 'think') {
          await sendChat(roomId, sessionId, { role: 'assistant', text: String((action as any).params?.text || '') });
        }
        if (action.name === 'todo') {
          const text = String((action as any).params?.text || '');
          if (text) await addTodo(sessionId, text);
        }
        if (action.name === 'add_detail') {
          enqueueDetail(((action as any).params ?? {}) as Record<string, unknown>);
        }
      }

      return worldActions.length;
    };

    await sendStatus(roomId, sessionId, 'streaming');
    const streamingEnabled = typeof provider.streamStructured === 'function' && process.env.CANVAS_AGENT_STREAMING !== 'false';
    const enqueueDetail = makeDetailEnqueuer(userMessage, 0);

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
    } else {
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
    }

    let next = scheduler.dequeue(sessionId);
    let loops = 0;
    while (next && loops < cfg.maxFollowups) {
      loops++;
      const followInputRaw = (next.input || {}) as Record<string, unknown>;
      const followInput = { ...followInputRaw };
      const followTargetIds = Array.isArray((followInput as any).targetIds)
        ? (followInput as any).targetIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
        : [];
      const followMessageRaw = typeof (followInput as any).message === 'string' ? (followInput as any).message : undefined;
      const followMessage = followMessageRaw && followMessageRaw.trim().length > 0 ? followMessageRaw : userMessage;
      const followBaseDepth =
        typeof (followInput as any).depth === 'number'
          ? Number((followInput as any).depth)
          : next.depth ?? loops;

      let followScreenshot: ScreenshotPayload | null = null;
      const followBounds = latestScreenshot?.bounds ?? latestScreenshot?.viewport ?? args.initialViewport;
      if (cfg.clientEnabled && followBounds) {
        try {
          const followRequestId = randomUUID();
          metrics.screenshotRequestId = followRequestId;
          metrics.screenshotTimeoutMs = cfg.screenshotTimeoutMs;
          metrics.screenshotRequestedAt = Date.now();
          await requestScreenshot(roomId, {
            sessionId,
            requestId: followRequestId,
            bounds: followBounds,
          });
          const timeoutAt = metrics.screenshotRequestedAt + cfg.screenshotTimeoutMs;
          while (Date.now() < timeoutAt) {
            const maybeScreenshot = screenshotInbox.takeScreenshot?.(sessionId, followRequestId) ?? null;
            if (maybeScreenshot) {
              followScreenshot = maybeScreenshot;
              metrics.screenshotReceivedAt = Date.now();
              metrics.imageBytes = maybeScreenshot.image?.bytes;
              if (typeof metrics.screenshotRequestedAt === 'number') {
                metrics.screenshotRtt = metrics.screenshotReceivedAt - metrics.screenshotRequestedAt;
              }
              metrics.screenshotResult = 'received';
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          if (!followScreenshot) {
            metrics.screenshotResult = 'timeout';
          }
        } catch (followScreenshotError) {
          metrics.screenshotResult = 'error';
          if (cfg.debug) {
            console.warn('[CanvasAgent:Screenshot]', 'Follow-up screenshot failed', followScreenshotError);
          }
        } finally {
          logMetrics(metrics, 'screenshot', followScreenshot ? 'received' : metrics.screenshotResult ?? 'none');
        }
      }

      if (followScreenshot) {
        latestScreenshot = followScreenshot;
        const { x, y, w, h } = followScreenshot.viewport;
        offset.setOrigin({ x: x + w / 2, y: y + h / 2 });
      }

      await sendStatus(roomId, sessionId, 'scheduled');
      const followParts = await buildPromptParts(roomId, {
        windowMs: 60000,
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

      if (followStreamingEnabled) {
        const structuredFollow = await followProvider.streamStructured?.(followPrompt, { system: CANVAS_AGENT_SYSTEM_PROMPT });
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
      } else {
        for await (const chunk of followProvider.stream(followPrompt, { system: CANVAS_AGENT_SYSTEM_PROMPT })) {
          if (chunk.type !== 'json') continue;
          const actionsRaw = (chunk.data as any)?.actions;
          if (!Array.isArray(actionsRaw) || actionsRaw.length === 0) continue;
          metrics.chunkCount++;
          const currentSeq = followSeq++;
          await processActions(actionsRaw, currentSeq, true, followEnqueueDetail);
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
        await sendActionsEnvelope(roomId, sessionId, currentSeq, fallback);
        envelopeDispatched = true;
        const ack = await awaitAck({ sessionId, seq: currentSeq, deadlineMs: 1200 });
        if (!ack) {
          await sendActionsEnvelope(roomId, sessionId, currentSeq, fallback);
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
            envelope: { v: ACTION_VERSION, sessionId, seq: currentSeq, actions: fallback, ts: Date.now() },
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
    logMetrics(metrics, 'complete');
  } catch (error) {
    metrics.completedAt = Date.now();
    logMetrics(metrics, 'error', error instanceof Error ? error.message : String(error));
    await sendStatus(roomId, sessionId, 'error', error instanceof Error ? error.message : String(error));
    throw error;
  }
}
