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

export const runtime = 'nodejs';

let queue: AgentTaskQueue | null = null;
function getQueue() {
  if (!queue) queue = new AgentTaskQueue();
  return queue;
}
const QUEUE_DIRECT_FALLBACK_ENABLED = process.env.CANVAS_QUEUE_DIRECT_FALLBACK === 'true';
const CLIENT_CANVAS_AGENT_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED, false);
const FAIRY_CLIENT_AGENT_ENABLED = isFairyClientAgentEnabled(process.env.NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED);
const CANVAS_STEWARD_ENABLED = (process.env.CANVAS_STEWARD_SERVER_EXECUTION ?? 'true') === 'true';
const SERVER_CANVAS_AGENT_ENABLED =
  CANVAS_STEWARD_ENABLED && !CLIENT_CANVAS_AGENT_ENABLED && !FAIRY_CLIENT_AGENT_ENABLED;
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = stewardRunCanvasRequestSchema.parse(body);
    const room = parsed.room;
    const task = parsed.task;
    const params = parsed.params;
    const summary = parsed.summary;
    const message = parsed.message;
    const requestId = parsed.requestId;
    if (room.trim().length === 0) {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }

    const normalizedTask = typeof task === 'string' && task.trim() ? task.trim() : 'canvas.agent_prompt';
    const normalizedParams = parseJsonObject(params) || {};
    const trimmedRoom = room.trim();

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

    if (normalizedTask === 'canvas.agent_prompt' && !normalizedParams.message) {
      return NextResponse.json({ error: 'Missing message for canvas.agent_prompt' }, { status: 400 });
    }

    try {
      // Lazily instantiate so `next build` doesn't require Supabase env vars.
      const enqueueResult = await getQueue().enqueueTask({
        room: trimmedRoom,
        task: normalizedTask,
        params: normalizedParams,
        requestId,
        resourceKeys: normalizedResourceKeys,
        coalesceByResource: normalizedTask === 'canvas.agent_prompt' || normalizedTask === 'fairy.intent',
      });
      if (normalizedTask === 'canvas.agent_prompt') {
        try {
          const rid = (requestId && String(requestId).trim()) || randomUUID();
          await broadcastAgentPrompt({
            room: trimmedRoom,
            payload: {
              message: String(normalizedParams.message || '').trim(),
              requestId: rid,
              bounds: parseBounds(normalizedParams.bounds),
              selectionIds: parseSelectionIds(normalizedParams.selectionIds),
              metadata: parseMetadata(normalizedParams.metadata),
            },
          });
        } catch (e) {
          logger.warn('broadcast agent prompt failed (post-enqueue)', { error: e });
        }
      }
      return NextResponse.json({ status: 'queued', task: enqueueResult }, { status: 202 });
    } catch (error) {
      // Graceful fallback: if Supabase is unavailable (e.g., Cloudflare 5xx), run immediately server-side
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('queue enqueue failed, falling back to direct run', { error: msg });

      if (normalizedTask === 'canvas.agent_prompt') {
        try {
          const rid = (requestId && String(requestId).trim()) || randomUUID();
          await broadcastAgentPrompt({
            room: trimmedRoom,
            payload: {
              message: String(normalizedParams.message || '').trim(),
              requestId: rid,
              bounds: parseBounds(normalizedParams.bounds),
              selectionIds: parseSelectionIds(normalizedParams.selectionIds),
              metadata: parseMetadata(normalizedParams.metadata),
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

      // 2) Execute the canvas steward right away so the canvas updates even during queue outages
      const canExecuteFallback =
        normalizedTask === 'canvas.agent_prompt' ? SERVER_CANVAS_AGENT_ENABLED : SERVER_CANVAS_TASKS_ENABLED;
      if (!canExecuteFallback) {
        return NextResponse.json({ status: 'broadcast_only' }, { status: 202 });
      }

      try {
        await runCanvasSteward({ task: normalizedTask, params: normalizedParams });
        return NextResponse.json({ status: 'executed_fallback' }, { status: 202 });
      } catch (e) {
        logger.error('fallback execution failed', { error: e });
        return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
      }
    }
  } catch (error) {
    logger.error('request parse failure', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
