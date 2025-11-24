import { randomUUID } from 'crypto';
import { selectModel } from './models';
import { buildPromptParts } from './context';
import { sanitizeActions } from './sanitize';
import { requestScreenshot, sendActionsEnvelope, sendChat, sendStatus, awaitAck } from './wire';
import { broadcastToolCall } from '@/lib/agents/shared/supabase-context';
import { ACTION_VERSION } from '@/lib/canvas-agent/contract/types';
import { OffsetManager, interpretBounds } from './offset';
import { handleStructuredStreaming } from './streaming';
import { parseAction } from '@/lib/canvas-agent/contract/parsers';
import { SessionScheduler } from './scheduler';
import { addTodo, listTodos } from './todos';
import { getCanvasShapeSummary } from '@/lib/agents/shared/supabase-context';
import { getModelTuning } from './model/presets';
import { BRAND_PRESETS } from '@/lib/brand/brand-presets';
import { validateCanonicalAction } from '@/lib/canvas-agent/contract/tooling/catalog';
import { resolveShapeType, sanitizeShapeProps } from '@/lib/canvas-agent/contract/shape-utils';
import { CANVAS_AGENT_SYSTEM_PROMPT } from '@/lib/canvas-agent/contract/system-prompt';
import { loadCanvasAgentConfig } from './config';
import { convertTeacherAction } from '@/lib/canvas-agent/contract/teacher-bridge';
import { streamTeacherAgent } from '@/lib/canvas-agent/teacher-runtime/service';
import { buildTeacherContextItems } from '@/lib/canvas-agent/teacher-runtime/context-items';
import { buildTeacherChatHistory } from '@/lib/canvas-agent/teacher-runtime/chat-history';
let screenshotInboxPromise = null;
const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
function loadScreenshotInbox() {
    if (!screenshotInboxPromise) {
        screenshotInboxPromise = import('@/server/inboxes/screenshot');
    }
    return screenshotInboxPromise;
}
const isPromptTooLongError = (error) => {
    if (!error || typeof error !== 'object')
        return false;
    const direct = typeof error?.message === 'string' ? String(error.message).toLowerCase() : '';
    if (direct.includes('prompt is too long'))
        return true;
    const nested = typeof error?.data?.error?.message === 'string' ? String(error.data.error.message).toLowerCase() : '';
    return nested.includes('prompt is too long');
};
const BRAND_COLOR_ALIASES = {
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
const sanitizeProps = (rawProps, shapeType) => sanitizeShapeProps(rawProps, shapeType, { colorAliases: BRAND_COLOR_ALIASES });
const mapTodosToTeacherItems = (todos) => {
    return todos
        .map((todo, index) => {
        const text = typeof todo.text === 'string' ? todo.text.trim() : '';
        if (!text)
            return null;
        const numericId = Number.isFinite(todo.position) ? Number(todo.position) : index;
        const status = todo.status === 'done' ? 'done' : 'todo';
        return {
            id: numericId,
            text,
            status,
        };
    })
        .filter((item) => Boolean(item));
};
const PRESET_SYNONYMS = {
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
const resolvePresetName = (raw) => {
    if (typeof raw !== 'string')
        return undefined;
    const normalized = raw.trim().toLowerCase();
    if (!normalized)
        return undefined;
    const direct = Object.keys(BRAND_PRESETS).find((key) => key.toLowerCase() === normalized);
    if (direct)
        return direct;
    if (PRESET_SYNONYMS[normalized])
        return PRESET_SYNONYMS[normalized];
    return undefined;
};
const coerceNumeric = (value) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
};
const expandMacroAction = (rawAction) => {
    if (!rawAction || typeof rawAction !== 'object')
        return null;
    if (rawAction.name !== 'apply_preset')
        return null;
    const params = typeof rawAction.params === 'object' && rawAction.params !== null ? { ...rawAction.params } : {};
    const presetName = resolvePresetName(params.preset ?? params.name ?? params.style);
    if (!presetName)
        return [];
    const preset = BRAND_PRESETS[presetName];
    const targetIds = Array.isArray(params.targetIds)
        ? params.targetIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
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
    const createId = typeof params.id === 'string' && params.id.trim().length > 0
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
const coerceNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
};
function logMetrics(metrics, cfg, event, detail) {
    if (!cfg.debug)
        return;
    const payload = { event, sessionId: metrics.sessionId, roomId: metrics.roomId, ts: Date.now() };
    if (metrics.preset)
        payload.preset = metrics.preset;
    if (event === 'ttfb' && metrics.ttfb !== undefined) {
        payload.ttfb = metrics.ttfb;
        payload.slo_met = metrics.ttfb <= cfg.ttfbSloMs;
        payload.slo_target = cfg.ttfbSloMs;
    }
    if (event === 'context') {
        if (metrics.blurryCount !== undefined)
            payload.blurry_count = metrics.blurryCount;
        if (metrics.peripheralCount !== undefined)
            payload.peripheral_count = metrics.peripheralCount;
        if (metrics.tokenBudgetMax !== undefined)
            payload.token_budget_max = metrics.tokenBudgetMax;
        if (metrics.transcriptTokenEstimate !== undefined)
            payload.transcript_tokens = metrics.transcriptTokenEstimate;
        if (metrics.selectedCount !== undefined)
            payload.selected_count = metrics.selectedCount;
        if (metrics.examplesCount !== undefined)
            payload.examples_count = metrics.examplesCount;
    }
    if (event === 'screenshot') {
        payload.request_id = metrics.screenshotRequestId;
        payload.timeout_ms = metrics.screenshotTimeoutMs;
        if (typeof metrics.imageBytes === 'number')
            payload.image_bytes = metrics.imageBytes;
        if (typeof metrics.screenshotRtt === 'number')
            payload.rtt = metrics.screenshotRtt;
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
        if (metrics.firstAckLatencyMs !== undefined)
            payload.first_ack_ms = metrics.firstAckLatencyMs;
        if (metrics.blurryCount !== undefined)
            payload.blurry_count = metrics.blurryCount;
        if (metrics.peripheralCount !== undefined)
            payload.peripheral_count = metrics.peripheralCount;
    }
    if (event === 'error') {
        payload.error = detail;
    }
    try {
        console.log('[CanvasAgent:Metrics]', JSON.stringify(payload));
    }
    catch { }
}
export async function runCanvasAgent(args) {
    const { roomId, userMessage: rawUserMessage, model, hooks: hookOverrides } = args;
    const hooks = hookOverrides ?? {};
    const userMessage = rawUserMessage.trim().length > 0
        ? rawUserMessage.trim()
        : 'Improve the layout. Clarify hierarchy and polish typography.';
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cfg = loadCanvasAgentConfig();
    if (cfg.mode === 'tldraw-teacher') {
        console.info('[CanvasAgent] running in tldraw-teacher mode (vendored TLDraw agent active)', {
            mode: cfg.mode,
            sessionId,
            roomId,
        });
    }
    else if (cfg.mode === 'shadow') {
        console.info('[CanvasAgent] running in shadow mode (present dispatch + teacher logging)', {
            mode: cfg.mode,
            sessionId,
            roomId,
        });
    }
    const scheduler = new SessionScheduler({ maxDepth: cfg.followups.maxDepth });
    const shapeTypeById = new Map();
    const offset = new OffsetManager();
    const screenshotInbox = await loadScreenshotInbox();
    if (args.initialViewport) {
        const { x, y, w, h } = args.initialViewport;
        offset.setOrigin({ x: x + w / 2, y: y + h / 2 });
    }
    const metrics = {
        sessionId,
        roomId,
        startedAt: Date.now(),
        chunkCount: 0,
        actionCount: 0,
        followupCount: 0,
        retryCount: 0,
        preset: cfg.preset,
    };
    logMetrics(metrics, cfg, 'start');
    let latestScreenshot = null;
    let screenshotEdge = cfg.screenshot.maxEdge;
    let lowActionRetryScheduled = false;
    let lastDispatchedChunk = null;
    let pendingViewportBounds = null;
    const captureScreenshot = async (label, bounds, attempt = 0, maxEdge = cfg.screenshot.maxEdge) => {
        const requestId = randomUUID();
        metrics.screenshotRequestId = requestId;
        metrics.screenshotTimeoutMs = cfg.screenshot.timeoutMs;
        metrics.screenshotRequestedAt = Date.now();
        try {
            await requestScreenshot(roomId, {
                sessionId,
                requestId,
                bounds,
                maxSize: maxEdge ? { w: maxEdge, h: maxEdge } : undefined,
            });
        }
        catch (error) {
            metrics.screenshotResult = 'error';
            logMetrics(metrics, cfg, 'screenshot', `${label}:error`);
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
                return maybeScreenshot;
            }
            await delay(20);
        }
        metrics.screenshotResult = 'timeout';
        logMetrics(metrics, cfg, 'screenshot', `${label}:timeout`);
        if (attempt < cfg.screenshot.retries) {
            if (cfg.debug) {
                console.warn('[CanvasAgent:Screenshot]', `Retrying ${label} capture (attempt ${attempt + 2})`);
            }
            await delay(cfg.screenshot.retryDelayMs);
            return captureScreenshot(label, bounds, attempt + 1, maxEdge);
        }
        return null;
    };
    const applyOffsetToActions = (actions) => {
        return actions.map((action) => {
            const params = action.params;
            if (!params || typeof params !== 'object')
                return action;
            const nextParams = { ...params };
            let mutated = false;
            if (typeof nextParams.x === 'number' && typeof nextParams.y === 'number') {
                const interpreted = offset.interpret({ x: Number(nextParams.x), y: Number(nextParams.y) });
                nextParams.x = interpreted.x;
                nextParams.y = interpreted.y;
                mutated = true;
            }
            const bounds = nextParams.bounds;
            if (bounds &&
                typeof bounds.x === 'number' &&
                typeof bounds.y === 'number' &&
                typeof bounds.w === 'number' &&
                typeof bounds.h === 'number') {
                nextParams.bounds = interpretBounds(bounds, offset);
                mutated = true;
            }
            return mutated ? { ...action, params: nextParams } : action;
        });
    };
    const enforceShapeProps = (actions) => actions.map((action) => {
        if (action.name !== 'create_shape' && action.name !== 'update_shape')
            return action;
        const params = action.params;
        if (!params || typeof params !== 'object')
            return action;
        const nextParams = { ...params };
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
            const sanitized = sanitizeProps({ ...nextParams.props }, inferredType);
            if (Object.keys(sanitized).length > 0)
                nextParams.props = sanitized;
            else
                delete nextParams.props;
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
        const buildPromptPayload = async (label) => {
            const startedAt = Date.now();
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
            const buildMs = Date.now() - startedAt;
            if (cfg.debug) {
                const screenshotBytes = parts?.screenshot?.bytes ?? metrics.imageBytes ?? 0;
                const selectedCount = Array.isArray(parts?.selectedSimpleShapes)
                    ? parts.selectedSimpleShapes.length
                    : 0;
                const blurryCount = Array.isArray(parts?.blurryShapes) ? parts.blurryShapes.length : 0;
                const peripheralCount = Array.isArray(parts?.peripheralClusters)
                    ? parts.peripheralClusters.length
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
            return { parts, prompt: JSON.stringify({ user: userMessage, parts }), buildMs };
        };
        const downscaleEdges = cfg.prompt.downscaleEdges;
        let downscaleCursor = 0;
        let promptPayload = await buildPromptPayload('initial');
        let promptLength = promptPayload.prompt.length;
        const applyPromptPayload = (payload) => {
            promptPayload = payload;
            promptLength = payload.prompt.length;
        };
        const attemptDownscaleEdge = async (reason) => {
            if (!latestScreenshot)
                return false;
            while (downscaleCursor < downscaleEdges.length) {
                const nextEdge = downscaleEdges[downscaleCursor++];
                if (nextEdge >= screenshotEdge)
                    continue;
                const smaller = await captureScreenshot('primary', args.initialViewport, 0, nextEdge);
                if (!smaller)
                    continue;
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
        const reducePrompt = async (reason) => {
            let modified = false;
            if (reason === 'api_error' && latestScreenshot) {
                const trimmed = await attemptDownscaleEdge(reason);
                if (trimmed) {
                    modified = true;
                }
            }
            while (promptLength > cfg.prompt.maxChars && latestScreenshot) {
                const trimmed = await attemptDownscaleEdge(reason);
                if (!trimmed)
                    break;
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
        const applyPromptMetadata = (currentParts) => {
            const budgetMeta = currentParts.promptBudget;
            if (budgetMeta) {
                metrics.tokenBudgetMax = budgetMeta.maxTokens;
                metrics.transcriptTokenEstimate = budgetMeta.transcriptTokens;
                metrics.blurryCount = budgetMeta.blurryCount;
                metrics.peripheralCount = budgetMeta.peripheralCount;
                metrics.selectedCount = budgetMeta.selectedCount;
            }
            if (Array.isArray(currentParts?.fewShotExamples)) {
                metrics.examplesCount = currentParts.fewShotExamples.length;
            }
        };
        const recordContextMetrics = () => {
            metrics.shapeCount = parts.shapes?.length || 0;
            metrics.transcriptLines = parts.transcript?.length || 0;
            metrics.docVersion = parts.docVersion;
            metrics.contextBuiltAt = Date.now();
            logMetrics(metrics, cfg, 'context');
        };
        applyPromptMetadata(parts);
        recordContextMetrics();
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
            }
            catch { }
        }
        let seq = 0;
        const sessionCreatedIds = new Set();
        metrics.modelCalledAt = Date.now();
        const rememberCreatedIds = (actions) => {
            for (const action of actions) {
                if (action.name === 'create_shape') {
                    const id = String(action.params?.id ?? '');
                    if (id)
                        sessionCreatedIds.add(id);
                }
                if (action.name === 'group') {
                    const id = String(action.params?.groupId ?? '');
                    if (id)
                        sessionCreatedIds.add(id);
                }
            }
        };
        const makeDetailEnqueuer = (baseMessage, baseDepth) => (params) => {
            const hint = typeof params.hint === 'string' ? params.hint.trim() : '';
            const previousDepth = typeof params.depth === 'number' ? Number(params.depth) : baseDepth;
            const nextDepth = previousDepth + 1;
            if (nextDepth > cfg.followups.maxDepth)
                return;
            const detailInput = {
                message: hint || baseMessage,
                originalMessage: baseMessage,
                depth: nextDepth,
                enqueuedAt: Date.now(),
            };
            if (hint)
                detailInput.hint = hint;
            const targetIds = Array.isArray(params.targetIds)
                ? params.targetIds.filter((id) => typeof id === 'string' && id.length > 0)
                : [];
            if (targetIds.length > 0)
                detailInput.targetIds = targetIds;
            const accepted = scheduler.enqueue(sessionId, { input: detailInput, depth: nextDepth });
            if (accepted)
                metrics.followupCount++;
        };
        /**
         * normalizeRawAction keeps create/update payloads in sync with the canonical
         * contract before we run schema validation. Most adjustments are structural
         * (moving props, coercing dimensions, resolving shape kinds). The lone
         * semantic fallback is the `line` → `rectangle` rewrite noted below, which is
         * a temporary crutch until the TLDraw contract exposes sized lines.
         */
        const normalizeRawAction = (raw, shapeTypeById) => {
            if (!raw || typeof raw !== 'object')
                return raw;
            const action = raw;
            if (action.name !== 'create_shape' && action.name !== 'update_shape')
                return action;
            if (action.name === 'create_shape') {
                const params = typeof action.params === 'object' && action.params !== null ? { ...action.params } : {};
                const kindValue = typeof params.kind === 'string' ? params.kind.trim().toLowerCase() : undefined;
                const candidateType = typeof params.type === 'string' ? params.type : kindValue;
                let resolvedType = candidateType ? resolveShapeType(candidateType) : undefined;
                if (!resolvedType) {
                    return null;
                }
                const hasDimension = coerceNumeric(params.w) !== undefined ||
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
                const props = typeof params.props === 'object' && params.props !== null ? { ...params.props } : {};
                const moveToProps = (source, target) => {
                    if (!(source in params))
                        return;
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
                const moveNumericToProps = (source, target) => {
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
                    }
                    else {
                        delete params.props;
                    }
                }
                else {
                    delete params.props;
                }
                if (typeof params.id === 'string' && params.id.trim().length > 0) {
                    shapeTypeById.set(params.id.trim(), params.type);
                }
                return { ...action, params };
            }
            // update_shape sanitization relies on previously seen create_shape entries
            if (action.name === 'update_shape') {
                const params = typeof action.params === 'object' && action.params !== null ? { ...action.params } : {};
                const targetId = typeof params.id === 'string' ? params.id.trim() : '';
                if (!targetId)
                    return null;
                let resolvedType = shapeTypeById.get(targetId);
                const candidateType = typeof params.type === 'string' ? resolveShapeType(params.type) : undefined;
                if (candidateType) {
                    resolvedType = candidateType;
                    shapeTypeById.set(targetId, candidateType);
                    delete params.type;
                }
                if (typeof params.props === 'object' && params.props !== null) {
                    const props = { ...params.props };
                    const sanitized = resolvedType ? sanitizeProps(props, resolvedType) : sanitizeProps(props, 'note');
                    if (Object.keys(sanitized).length > 0)
                        params.props = sanitized;
                    else
                        delete params.props;
                }
                params.id = targetId;
                return { ...action, params };
            }
            return action;
        };
        const processActions = async (rawActions, seqNumber, partial, enqueueDetail, options) => {
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
                }
                catch { }
            }
            if (!Array.isArray(rawActions) || rawActions.length === 0)
                return 0;
            const parsed = [];
            const dropStats = {
                duplicateCreates: 0,
                invalidSchema: 0,
            };
            const queue = [];
            for (const candidate of rawActions) {
                const teacherConverted = convertTeacherAction(candidate);
                const baseCandidate = teacherConverted
                    ? {
                        id: typeof candidate?.id === 'string' ? candidate.id : undefined,
                        name: teacherConverted.name,
                        params: teacherConverted.params,
                    }
                    : candidate;
                const macros = expandMacroAction(baseCandidate);
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
                if (!shape?.id || typeof shape.id !== 'string')
                    continue;
                const normalizedType = resolveShapeType(shape.type);
                if (normalizedType) {
                    shapeTypeById.set(shape.id, normalizedType);
                }
                else if (typeof shape.type === 'string' && shape.type.trim().length > 0) {
                    shapeTypeById.set(shape.id, shape.type.trim());
                }
            }
            const chunkCreatedIds = new Set();
            const knownIds = new Set([
                ...existingShapeIds,
                ...sessionCreatedIds,
            ]);
            for (const item of queue) {
                let normalized = normalizeRawAction(item, shapeTypeById);
                if (!normalized)
                    continue;
                if (normalized.name === 'create_shape') {
                    const shapeId = String(normalized.params?.id ?? '').trim();
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
                const schemaValidation = validateCanonicalAction(normalized);
                if (!schemaValidation.ok) {
                    dropStats.invalidSchema++;
                    if (!partial) {
                        console.warn('[CanvasAgent:SchemaGuard] Dropping invalid action', {
                            roomId,
                            sessionId,
                            seq: seqNumber,
                            name: normalized?.name,
                            issues: schemaValidation.issues,
                        });
                    }
                    continue;
                }
                try {
                    parsed.push(parseAction({ id: String(normalized?.id || `${Date.now()}`), name: normalized?.name, params: normalized?.params }));
                }
                catch (parseError) {
                    if (cfg.debug) {
                        console.warn('[CanvasAgent:ParseActionError]', {
                            roomId,
                            sessionId,
                            seq: seqNumber,
                            action: normalized?.name,
                            error: parseError instanceof Error ? parseError.message : String(parseError),
                        });
                    }
                }
            }
            if (dropStats.duplicateCreates || dropStats.invalidSchema) {
                console.log('[CanvasAgent:ActionDrops]', JSON.stringify({
                    sessionId,
                    roomId,
                    seq: seqNumber,
                    duplicateCreates: dropStats.duplicateCreates,
                    invalidSchema: dropStats.invalidSchema,
                }));
            }
            if (parsed.length === 0) {
                return 0;
            }
            const exists = (id) => sessionCreatedIds.has(id) || chunkCreatedIds.has(id) || existingShapeIds.has(id);
            const clean = sanitizeActions(parsed, exists);
            if (shouldDispatch) {
                rememberCreatedIds(clean);
            }
            if (clean.length === 0)
                return 0;
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
                }
                catch { }
            }
            const worldActions = applyOffsetToActions(enforceShapeProps(clean));
            if (worldActions.length === 0)
                return 0;
            const dispatchableActions = worldActions.filter((action) => action.name !== 'message');
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
                    await sendActionsEnvelope(roomId, sessionId, seqNumber, dispatchableActions, { partial });
                    const ack = await awaitAck({ sessionId, seq: seqNumber, deadlineMs: 1200 });
                    if (ack && metrics.firstAckLatencyMs === undefined) {
                        metrics.firstAckLatencyMs = Date.now() - metrics.startedAt;
                    }
                    if (!ack) {
                        metrics.retryCount++;
                        await sendActionsEnvelope(roomId, sessionId, seqNumber, dispatchableActions, { partial });
                        const retryAck = await awaitAck({ sessionId, seq: seqNumber, deadlineMs: 800 });
                        if (retryAck && metrics.firstAckLatencyMs === undefined) {
                            metrics.firstAckLatencyMs = Date.now() - metrics.startedAt;
                        }
                    }
                }
            }
            if (shouldDispatch) {
                for (const action of [...dispatchableActions, ...chatOnlyActions]) {
                    if (action.name === 'think') {
                        const thought = String(action.params?.text || '');
                        if (thought) {
                            try {
                                await sendChat(roomId, sessionId, { role: 'assistant', text: thought });
                            }
                            catch (chatError) {
                                console.warn('[CanvasAgent:ThinkChatError]', {
                                    roomId,
                                    sessionId,
                                    error: chatError instanceof Error ? chatError.message : chatError,
                                });
                            }
                        }
                    }
                    if (action.name === 'todo') {
                        const text = String(action.params?.text || '');
                        if (text) {
                            try {
                                await addTodo(sessionId, text);
                            }
                            catch (todoError) {
                                console.warn('[CanvasAgent:TodoError]', {
                                    roomId,
                                    sessionId,
                                    error: todoError instanceof Error ? todoError.message : todoError,
                                });
                            }
                        }
                    }
                    if (action.name === 'add_detail') {
                        enqueueDetail((action.params ?? {}));
                    }
                    if (action.name === 'message') {
                        const text = String(action.params?.text || '').trim();
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
        const enqueueDetail = makeDetailEnqueuer(userMessage, 0);
        if (cfg.debug) {
            try {
                console.log('[CanvasAgent:StreamingMode]', JSON.stringify({
                    sessionId,
                    roomId,
                    streamingEnabled,
                    provider: provider.name,
                }));
            }
            catch { }
        }
        const shapesForTeacher = Array.isArray(parts?.shapes)
            ? parts.shapes
            : [];
        const selectedForTeacher = Array.isArray(parts?.selectedSimpleShapes)
            ? parts.selectedSimpleShapes
            : [];
        const teacherContext = {
            userMessages: [userMessage],
            requestType: 'user',
            screenshotDataUrl: latestScreenshot?.image?.dataUrl ||
                (typeof promptPayload.parts?.screenshot?.dataUrl === 'string'
                    ? promptPayload.parts.screenshot.dataUrl
                    : null),
            bounds: (latestScreenshot?.viewport ?? args.initialViewport) || null,
            viewport: (latestScreenshot?.viewport ?? args.initialViewport) || null,
            styleInstructions: typeof promptPayload.parts?.styleInstructions === 'string'
                ? promptPayload.parts.styleInstructions
                : undefined,
            promptBudget: typeof promptPayload.parts?.promptBudget === 'object'
                ? promptPayload.parts.promptBudget
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
        const transcriptForTeacher = Array.isArray(parts?.transcript)
            ? parts.transcript
            : [];
        const teacherChatHistory = buildTeacherChatHistory({ transcript: transcriptForTeacher });
        if (teacherChatHistory && teacherChatHistory.length > 0) {
            teacherContext.chatHistory = teacherChatHistory;
        }
        const existingTodos = await listTodos(sessionId);
        const teacherTodoItems = mapTodosToTeacherItems(existingTodos);
        if (teacherTodoItems.length > 0) {
            teacherContext.todoItems = teacherTodoItems;
        }
        const runTeacherStream = async (dispatchActions) => {
            const streamStartedAt = Date.now();
            let seqTeacher = 1;
            let firstPartialLogged = false;
            for await (const event of streamTeacherAgent(teacherContext)) {
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
                if (!event?.complete)
                    continue;
                const currentSeq = seqTeacher++;
                await processActions([event], currentSeq, false, enqueueDetail, {
                    dispatch: dispatchActions,
                    source: 'teacher',
                });
            }
        };
        let shadowTeacherPromise = null;
        if (cfg.mode === 'tldraw-teacher') {
            await runTeacherStream(true);
            return;
        }
        if (cfg.mode === 'shadow') {
            shadowTeacherPromise = runTeacherStream(false).catch((error) => {
                console.warn('[CanvasAgent:ShadowTeacherError]', {
                    roomId,
                    sessionId,
                    error: error instanceof Error ? error.message : error,
                });
            });
        }
        const invokeModel = async () => {
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
                    }
                    catch { }
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
                    }
                    catch { }
                }
                if (structured) {
                    let rawProcessed = 0;
                    await handleStructuredStreaming(structured, async (delta) => {
                        if (!Array.isArray(delta) || delta.length === 0)
                            return;
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
                    }, async (finalActions) => {
                        if (!Array.isArray(finalActions) || finalActions.length === 0)
                            return;
                        const pending = finalActions.slice(rawProcessed);
                        rawProcessed = finalActions.length;
                        if (pending.length === 0)
                            return;
                        const currentSeq = seq++;
                        await processActions(pending, currentSeq, false, enqueueDetail);
                    });
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
                }
                catch { }
            }
            for await (const chunk of provider.stream(prompt, { system: CANVAS_AGENT_SYSTEM_PROMPT, tuning })) {
                if (chunk.type !== 'json')
                    continue;
                const actionsRaw = chunk.data?.actions;
                if (!Array.isArray(actionsRaw) || actionsRaw.length === 0)
                    continue;
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
        while (true) {
            try {
                await invokeModel();
                break;
            }
            catch (error) {
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
                throw error;
            }
        }
        if (!lowActionRetryScheduled && metrics.actionCount < cfg.followups.lowActionThreshold) {
            const retryHint = 'Add more layout detail: ensure there is a headline block, supporting shapes, and three sticky notes with copy ideas.';
            const enqueued = scheduler.enqueue(sessionId, {
                input: {
                    message: `${userMessage}\n\nFocus on finishing the layout, not narration.`,
                    hint: retryHint,
                    strict: true,
                    reason: 'low_action',
                },
                depth: 1,
            });
            lowActionRetryScheduled = enqueued;
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
            const followInputRaw = (next.input || {});
            const followInput = { ...followInputRaw };
            const followTargetIds = Array.isArray(followInput.targetIds)
                ? followInput.targetIds.filter((id) => typeof id === 'string' && id.length > 0)
                : [];
            const followMessageRaw = typeof followInput.message === 'string' ? followInput.message : undefined;
            const followMessage = followMessageRaw && followMessageRaw.trim().length > 0 ? followMessageRaw : userMessage;
            const followBaseDepth = typeof followInput.depth === 'number'
                ? Number(followInput.depth)
                : next.depth ?? loops;
            let followScreenshot = null;
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
            const followBudget = followParts.promptBudget;
            if (followBudget) {
                metrics.tokenBudgetMax = followBudget.maxTokens;
                metrics.transcriptTokenEstimate = followBudget.transcriptTokens;
                metrics.blurryCount = followBudget.blurryCount;
                metrics.peripheralCount = followBudget.peripheralCount;
            }
            metrics.transcriptLines = followParts.transcript?.length ?? metrics.transcriptLines;
            metrics.shapeCount = followParts.shapes?.length ?? metrics.shapeCount;
            metrics.docVersion = followParts.docVersion ?? metrics.docVersion;
            const followPayload = { user: followMessage, parts: followParts };
            if (Object.keys(followInput).length > 0) {
                followPayload.followup = followInput;
            }
            const followPrompt = JSON.stringify(followPayload);
            const followProvider = selectModel(model || cfg.modelName);
            let followSeq = 0;
            const followEnqueueDetail = makeDetailEnqueuer(followMessage, followBaseDepth);
            const followStreamingEnabled = typeof followProvider.streamStructured === 'function' && process.env.CANVAS_AGENT_STREAMING !== 'false';
            const followPresetName = (followInput.strict ? 'precise' : cfg.preset);
            const followTuning = getModelTuning(followPresetName);
            if (followStreamingEnabled) {
                const structuredFollow = await followProvider.streamStructured?.(followPrompt, {
                    system: CANVAS_AGENT_SYSTEM_PROMPT,
                    tuning: followTuning,
                });
                if (structuredFollow) {
                    let followRawProcessed = 0;
                    await handleStructuredStreaming(structuredFollow, async (delta) => {
                        if (!Array.isArray(delta) || delta.length === 0)
                            return;
                        metrics.chunkCount++;
                        const currentSeq = followSeq++;
                        await processActions(delta, currentSeq, true, followEnqueueDetail);
                        followRawProcessed += delta.length;
                    }, async (finalActions) => {
                        if (!Array.isArray(finalActions) || finalActions.length === 0)
                            return;
                        const pending = finalActions.slice(followRawProcessed);
                        followRawProcessed = finalActions.length;
                        if (pending.length === 0)
                            return;
                        const currentSeq = followSeq++;
                        await processActions(pending, currentSeq, false, followEnqueueDetail);
                    });
                }
            }
            else {
                for await (const chunk of followProvider.stream(followPrompt, { system: CANVAS_AGENT_SYSTEM_PROMPT, tuning: followTuning })) {
                    if (chunk.type !== 'json')
                        continue;
                    const actionsRaw = chunk.data?.actions;
                    if (!Array.isArray(actionsRaw) || actionsRaw.length === 0)
                        continue;
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
                    name: 'create_shape',
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
                    name: 'set_viewport',
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
            }
            catch (error) {
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
            }
            catch (error) {
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
        if (shadowTeacherPromise) {
            await shadowTeacherPromise;
        }
    }
    catch (error) {
        const detail = error instanceof Error
            ? `${error.name}: ${error.message}`
            : (() => {
                try {
                    return JSON.stringify(error);
                }
                catch {
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
        await sendStatus(roomId, sessionId, 'error', detail);
        throw error;
    }
}
//# sourceMappingURL=runner.js.map