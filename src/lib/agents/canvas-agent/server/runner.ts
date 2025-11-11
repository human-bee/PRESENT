import { randomUUID } from 'crypto';
import { selectModel } from './models';
import { buildPromptParts } from './context';
import { sanitizeActions } from './sanitize';
import { requestScreenshot, sendActionsEnvelope, sendChat, sendStatus, awaitAck } from './wire';
import { OffsetManager, interpretBounds } from './offset';
import { handleStructuredStreaming } from './streaming';
import type { AgentAction } from '../shared/types';
import { parseAction } from '../shared/parsers';
import { SessionScheduler } from './scheduler';
import { addTodo } from './todos';
import { getCanvasShapeSummary } from '@/lib/agents/shared/supabase-context';
import type { ScreenshotPayload } from '@/server/inboxes/screenshot';
import * as ScreenshotInbox from '@/server/inboxes/screenshot';
import { getModelTuning, resolvePreset, resolveFollowupDepth } from './model/presets';


type RunArgs = { roomId: string; userMessage: string; model?: string; initialViewport?: { x: number; y: number; w: number; h: number } };

const CANVAS_AGENT_SYSTEM_PROMPT = `You are a creative canvas agent with access to the TLDraw canvas.

You can see the current canvas state including shapes, their positions, sizes, colors, and the user's viewport.
You receive user requests and respond by emitting TLDraw-native actions to create, modify, or delete shapes.

Available actions:
- create_shape: Create rectangles, ellipses, arrows, notes, text, images, and more
- update_shape: Modify existing shapes (position, size, color, text, props)
- delete_shape: Remove shapes by ID
- draw_pen: Draw freehand pen strokes
- move/resize/rotate: Transform shapes
- group/ungroup: Organize shapes into groups
- align/distribute/stack/reorder: Arrange multiple shapes
- think: Share your reasoning with the user (appears in chat)
- todo: Create a persistent task for later follow-up
- add_detail: Request a follow-up turn to add more detail to specific shapes
- set_viewport: Pan/zoom the canvas to focus on specific content

Always respond with JSON containing an "actions" array. Each action must have:
- id: unique identifier (string)
- name: action name from the list above
- params: object with action-specific parameters

Be creative, precise, and considerate of existing canvas content. When in doubt, make reasonable assumptions.`;

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
    screenshotTimeoutMs: Number(env.CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS ?? 300),
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
        const maybeScreenshot = ScreenshotInbox.takeScreenshot?.(sessionId, screenshotRequestId) ?? null;
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
    const provider = selectModel(model || cfg.modelName);
    const tuning = getModelTuning(cfg.preset);
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

    const processActions = async (
      rawActions: unknown,
      seqNumber: number,
      partial: boolean,
      enqueueDetail: (params: Record<string, unknown>) => void,
    ) => {
      if (!Array.isArray(rawActions) || rawActions.length === 0) return 0;
      const parsed: AgentAction[] = [];
      for (const a of rawActions) {
        try {
          parsed.push(parseAction({ id: String((a as any)?.id || `${Date.now()}`), name: (a as any)?.name, params: (a as any)?.params }));
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

    if (streamingEnabled) {
      const streamStartedAt = Date.now();
      let firstPartialLogged = false;
      const structured = await provider.streamStructured?.(prompt, {
        system: CANVAS_AGENT_SYSTEM_PROMPT,
        tuning,
      });
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
            const maybeScreenshot = ScreenshotInbox.takeScreenshot?.(sessionId, followRequestId) ?? null;
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
