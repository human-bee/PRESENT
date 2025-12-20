import { NextRequest, NextResponse } from 'next/server';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { runCanvasSteward } from '@/lib/agents/subagents/canvas-steward';
import { broadcastAgentPrompt } from '@/lib/agents/shared/supabase-context';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const queue = new AgentTaskQueue();
const QUEUE_DIRECT_FALLBACK_ENABLED = process.env.CANVAS_QUEUE_DIRECT_FALLBACK === 'true';
const CLIENT_CANVAS_AGENT_ENABLED = process.env.NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED === 'true';
const FAIRY_CANVAS_AGENT_ENABLED = process.env.NEXT_PUBLIC_FAIRY_ENABLED === 'true';
const CANVAS_STEWARD_ENABLED = (process.env.CANVAS_STEWARD_SERVER_EXECUTION ?? 'true') === 'true';
const SERVER_CANVAS_AGENT_ENABLED =
  CANVAS_STEWARD_ENABLED && !CLIENT_CANVAS_AGENT_ENABLED && !FAIRY_CANVAS_AGENT_ENABLED;
const SERVER_CANVAS_TASKS_ENABLED = CANVAS_STEWARD_ENABLED && !CLIENT_CANVAS_AGENT_ENABLED;

export async function POST(req: NextRequest) {
  try {
    const { room, task, params, summary, message, requestId } = await req.json();
    if (typeof room !== 'string' || room.trim().length === 0) {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }

    const normalizedTask = typeof task === 'string' && task.trim() ? task.trim() : 'canvas.agent_prompt';
    const normalizedParams = Object(params) === params ? { ...params } : {};
    const trimmedRoom = room.trim();

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
      const enqueueResult = await queue.enqueueTask({
        room: trimmedRoom,
        task: normalizedTask,
        params: normalizedParams,
        requestId,
        resourceKeys: [`room:${trimmedRoom}`],
      });
      if (normalizedTask === 'canvas.agent_prompt') {
        try {
          const rid = (requestId && String(requestId).trim()) || randomUUID();
          await broadcastAgentPrompt({
            room: trimmedRoom,
            payload: {
              message: String(normalizedParams.message || '').trim(),
              requestId: rid,
              bounds: normalizedParams.bounds,
              selectionIds: normalizedParams.selectionIds,
              metadata: normalizedParams.metadata ?? null,
            },
          });
        } catch (e) {
          console.warn('[Steward][runCanvas] broadcast agent prompt failed (post-enqueue)', e);
        }
      }
      return NextResponse.json({ status: 'queued', task: enqueueResult }, { status: 202 });
    } catch (error) {
      // Graceful fallback: if Supabase is unavailable (e.g., Cloudflare 5xx), run immediately server-side
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[Steward][runCanvas] queue enqueue failed, falling back to direct run', msg);

      if (normalizedTask === 'canvas.agent_prompt') {
        try {
          const rid = (requestId && String(requestId).trim()) || randomUUID();
          await broadcastAgentPrompt({
            room: trimmedRoom,
            payload: {
              message: String(normalizedParams.message || '').trim(),
              requestId: rid,
              bounds: normalizedParams.bounds,
              selectionIds: normalizedParams.selectionIds,
              metadata: normalizedParams.metadata ?? null,
            },
          });
        } catch (e) {
          console.warn('[Steward][runCanvas] broadcast agent prompt failed in fallback', e);
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
        console.error('[Steward][runCanvas] fallback execution failed', e);
        return NextResponse.json({ error: 'Dispatch failed' }, { status: 502 });
      }
    }
  } catch (error) {
    console.error('[Steward][runCanvas] error', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
