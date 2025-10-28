import { selectModel } from './models';
import { buildPromptParts } from './context';
import { sanitizeActions } from './sanitize';
import { sendActionsEnvelope, sendChat, sendStatus } from './wire';
import * as AckInbox from '@/server/inboxes/ack';
import type { AgentAction } from '../shared/types';
import { parseAction } from '../shared/parsers';
import { SessionScheduler } from './scheduler';
import { addTodo } from './todos';
import { getCanvasShapeSummary } from '@/lib/agents/shared/supabase-context';


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
};

function getEnvConfig() {
  const env = process.env;
  return {
    modelName: env.CANVAS_STEWARD_MODEL,
    debug: env.CANVAS_STEWARD_DEBUG === 'true',
    screenshotTimeoutMs: Number(env.CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS ?? 300),
    ttfbSloMs: Number(env.CANVAS_AGENT_TTFB_SLO_MS ?? 200),
    clientEnabled: env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED !== 'false',
    maxFollowups: Number(env.CANVAS_AGENT_MAX_FOLLOWUPS ?? 3),
  } as const;
}

function logMetrics(metrics: SessionMetrics, event: 'start' | 'context' | 'ttfb' | 'complete' | 'error', detail?: unknown) {
  const cfg = getEnvConfig();
  if (!cfg.debug) return;
  const payload: Record<string, unknown> = { event, sessionId: metrics.sessionId, roomId: metrics.roomId, ts: Date.now() };
  if (event === 'ttfb' && metrics.ttfb !== undefined) {
    payload.ttfb = metrics.ttfb;
    payload.slo_met = metrics.ttfb <= cfg.ttfbSloMs;
    payload.slo_target = cfg.ttfbSloMs;
  }
  if (event === 'complete') {
    payload.duration = metrics.completedAt ? metrics.completedAt - metrics.startedAt : 0;
    payload.chunkCount = metrics.chunkCount;
    payload.actionCount = metrics.actionCount;
    payload.followupCount = metrics.followupCount;
    payload.shapeCount = metrics.shapeCount;
    payload.transcriptLines = metrics.transcriptLines;
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

  const metrics: SessionMetrics = {
    sessionId,
    roomId,
    startedAt: Date.now(),
    chunkCount: 0,
    actionCount: 0,
    followupCount: 0,
    retryCount: 0,
  };

  logMetrics(metrics, 'start');

  try {
    await sendStatus(roomId, sessionId, 'waiting_context');
    const parts = await buildPromptParts(roomId, { windowMs: 60000, viewport: args.initialViewport, selection: [], sessionId });
    const prompt = JSON.stringify({ user: userMessage, parts });

    metrics.contextBuiltAt = Date.now();
    metrics.shapeCount = (parts as any).shapes?.length || 0;
    metrics.transcriptLines = (parts as any).transcript?.length || 0;
    metrics.docVersion = (parts as any).docVersion;
    logMetrics(metrics, 'context');

    await sendStatus(roomId, sessionId, 'calling_model');
    const provider = selectModel(model || cfg.modelName);
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

    await sendStatus(roomId, sessionId, 'streaming');
    for await (const chunk of provider.stream(prompt, { system: CANVAS_AGENT_SYSTEM_PROMPT })) {
      metrics.chunkCount++;
      if (chunk.type === 'json') {
        const actionsRaw = (chunk.data as any)?.actions;
        if (Array.isArray(actionsRaw)) {
          const parsed: AgentAction[] = [];
          for (const a of actionsRaw) {
            try { parsed.push(parseAction({ id: String(a.id || `${Date.now()}`), name: a.name, params: a.params })); } catch {}
          }
          const canvas = await getCanvasShapeSummary(roomId);
          const exists = (id: string) => sessionCreatedIds.has(id) || canvas.shapes.some((s) => s.id === id);
          const clean = sanitizeActions(parsed, exists);
          rememberCreatedIds(clean);

          if (!metrics.firstActionAt && clean.length > 0) {
            metrics.firstActionAt = Date.now();
            metrics.ttfb = metrics.firstActionAt - metrics.startedAt;
            logMetrics(metrics, 'ttfb');
          }

          metrics.actionCount += clean.length;
          const currentSeq = seq++;
          await sendActionsEnvelope(roomId, sessionId, currentSeq, clean, { partial: true });
          const ackTimeoutMs = 500;
          const started = Date.now();
          while (Date.now() - started < ackTimeoutMs && !AckInbox.hasAck?.(sessionId, currentSeq)) {
            await new Promise((r) => setTimeout(r, 20));
          }
          if (!AckInbox.hasAck?.(sessionId, currentSeq)) {
            await sendActionsEnvelope(roomId, sessionId, currentSeq, clean, { partial: true });
          }

          for (const action of clean) {
            if (action.name === 'think') {
              await sendChat(roomId, sessionId, { role: 'assistant', text: String((action as any).params?.text || '') });
            }
            if (action.name === 'todo') {
              const text = String((action as any).params?.text || '');
              if (text) await addTodo(sessionId, text);
            }
            if (action.name === 'add_detail') {
              scheduler.enqueue(sessionId, { input: { message: userMessage } });
              metrics.followupCount++;
            }
          }
        }
      }
    }

    let next = scheduler.dequeue(sessionId);
    let loops = 0;
    while (next && loops < cfg.maxFollowups) {
      loops++;
      await sendStatus(roomId, sessionId, 'scheduled');
      const followParts = await buildPromptParts(roomId, { windowMs: 60000, viewport: args.initialViewport, selection: [], sessionId });
      const followPrompt = JSON.stringify({ user: userMessage, parts: followParts });
      let followSeq = 0;
      for await (const chunk of selectModel(model || cfg.modelName).stream(followPrompt, { system: CANVAS_AGENT_SYSTEM_PROMPT })) {
        if (chunk.type !== 'json') continue;
        const actionsRaw = (chunk.data as any)?.actions;
        if (!Array.isArray(actionsRaw)) continue;
        const parsed: AgentAction[] = [];
        for (const a of actionsRaw) {
          try { parsed.push(parseAction({ id: String(a.id || `${Date.now()}`), name: a.name, params: a.params })); } catch {}
        }
        const canvas = await getCanvasShapeSummary(roomId);
        const exists = (id: string) => sessionCreatedIds.has(id) || canvas.shapes.some((s) => s.id === id);
        const clean = sanitizeActions(parsed, exists);
        rememberCreatedIds(clean);
        if (clean.length === 0) continue;
        metrics.actionCount += clean.length;
        const currentSeq = followSeq++;
        await sendActionsEnvelope(roomId, sessionId, currentSeq, clean, { partial: true });
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


