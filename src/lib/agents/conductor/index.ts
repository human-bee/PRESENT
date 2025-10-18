import { Agent, run } from '@openai/agents';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { jsonObjectSchema, type JsonObject } from '@/lib/utils/json-schema';
import {
  broadcastAgentPrompt,
  broadcastToolCall,
  type CanvasAgentPromptPayload,
} from '@/lib/agents/shared/supabase-context';
import { activeFlowchartSteward } from '../subagents/flowchart-steward-registry';
import { runCanvasSteward, enqueueCanvasPrompt } from '../subagents/canvas-steward';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { resolveIntent, getObject, getString } from './intent-resolver';

const queue = new AgentTaskQueue();
const ROOM_CONCURRENCY = Number(process.env.TASK_DEFAULT_CONCURRENCY ?? 1);

const CanvasAgentPromptSchema = z
  .object({
    room: z.string().min(1, 'room is required'),
    message: z.string().min(1, 'message is required'),
    requestId: z.string().min(1).optional(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      })
      .partial({ w: true, h: true })
      .optional(),
    selectionIds: z.array(z.string().min(1)).optional(),
    metadata: jsonObjectSchema.optional(),
  })
  .passthrough();

async function handleCanvasAgentPrompt(rawParams: JsonObject) {
  const parsed = CanvasAgentPromptSchema.parse(rawParams);
  const requestId = (parsed.requestId || randomUUID()).trim();
  const payload: CanvasAgentPromptPayload = {
    message: parsed.message.trim(),
    requestId,
    bounds: parsed.bounds,
    selectionIds: parsed.selectionIds,
    metadata: parsed.metadata ?? null,
  };

  await broadcastAgentPrompt({
    room: parsed.room.trim(),
    payload,
  });

  return { status: 'queued', requestId, room: parsed.room.trim(), payload };
}

async function executeTask(taskName: string, params: JsonObject) {
  if (!taskName || taskName === 'auto') {
    const resolution = resolveIntent(params);
    if (resolution) {
      if (resolution.kind === 'tool_call') {
        const room = resolveRoom(params);
        await broadcastToolCall({ room, tool: resolution.tool, params: resolution.params });
        return { status: 'handled', tool: resolution.tool };
      }
      if (resolution.kind === 'task') {
        const nextParams = resolution.params ? { ...params, ...resolution.params } : params;
        return executeTask(resolution.task, nextParams);
      }
    }
    const fallbackParams = params.message
      ? params
      : { ...params, message: resolveIntentText(params) };
    return executeTask('canvas.agent_prompt', fallbackParams);
  }

  if (taskName === 'conductor.dispatch') {
    const nextTask = typeof params?.task === 'string' ? params.task : 'auto';
    const payload = (params?.params as JsonObject) ?? params;
    return executeTask(nextTask, payload ?? {});
  }

  if (taskName.startsWith('flowchart.')) {
    const result = await run(activeFlowchartSteward, JSON.stringify({ task: taskName, params }));
    return result.finalOutput;
  }

  if (taskName === 'canvas.agent_prompt') {
    const promptResult = await handleCanvasAgentPrompt(params);
    // Use coalescing queue to debounce rapid canvas prompts
    await enqueueCanvasPrompt({
      room: promptResult.room,
      message: promptResult.payload.message,
      requestId: promptResult.payload.requestId,
      metadata: promptResult.payload.metadata ?? undefined,
    });
    return { ...promptResult, status: 'debounced' };
  }

  if (taskName.startsWith('canvas.')) {
    return runCanvasSteward({ task: taskName, params });
  }

  throw new Error(`No steward for task: ${taskName}`);
}

function resolveRoom(params: JsonObject): string {
  const direct = getString(params, 'room');
  if (direct) return direct;
  const metadata = getObject(params, 'metadata');
  const metaRoom = metadata ? getString(metadata, 'room') : undefined;
  if (metaRoom) return metaRoom;
  const participants = params.participants;
  if (typeof participants === 'string') {
    const trimmed = participants.trim();
    if (trimmed) return trimmed;
  }
  if (Array.isArray(participants)) {
    for (const entry of participants) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed) return trimmed;
      }
      if (typeof entry === 'object' && entry !== null && typeof entry.room === 'string') {
        const trimmed = entry.room.trim();
        if (trimmed) return trimmed;
      }
    }
  }
  throw new Error('Room is required for conductor execution');
}

function resolveIntentText(params: JsonObject): string {
  const transcript = getString(params, 'transcript');
  if (transcript) return transcript;
  const metadata = getObject(params, 'metadata');
  const metaMessage = metadata ? getString(metadata, 'message') : undefined;
  if (metaMessage) return metaMessage;
  const intent = getString(params, 'intent');
  if (intent) return intent;
  const message = getString(params, 'message');
  if (message) return message;
  return 'Please assist on the canvas';
}

async function workerLoop() {
  while (true) {
    const { leaseToken, tasks } = await queue.claimTasks({ limit: Number(process.env.TASK_DEFAULT_CONCURRENCY ?? 10) });

    if (tasks.length === 0) {
      await delay(500);
      continue;
    }

    const roomBuckets = tasks.reduce<Record<string, typeof tasks>>((acc, task) => {
      const roomKey = task.resource_keys.find((key) => key.startsWith('room:')) || 'room:default';
      if (!acc[roomKey]) acc[roomKey] = [];
      acc[roomKey].push(task);
      return acc;
    }, {});

    await Promise.allSettled(
      Object.entries(roomBuckets).map(async ([roomKey, roomTasks]) => {
        const concurrency = ROOM_CONCURRENCY;
        const queueList = [...roomTasks];
        const workers = Array.from({ length: concurrency }).map(async () => {
          while (queueList.length > 0) {
            const task = queueList.shift();
            if (!task) break;
            try {
              const startedAt = Date.now();
              const result = await executeTask(task.task, task.params);
              await queue.completeTask(task.id, leaseToken, result as JsonObject);
              const durationMs = Date.now() - startedAt;
              console.log('[Conductor] task completed', { roomKey, taskId: task.id, durationMs });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const retryAt = task.attempt < 3 ? new Date(Date.now() + Math.pow(2, task.attempt) * 1000) : undefined;
              console.warn('[Conductor] task failed', { roomKey, taskId: task.id, task: task.task, attempt: task.attempt, retryAt, error: message });
              await queue.failTask(task.id, leaseToken, { error: message, retryAt });
            }
          }
        });
        await Promise.allSettled(workers);
      }),
    );
  }
}

void workerLoop().catch((err) => {
  console.error('[Conductor] worker failed', err);
});

export const conductor = new Agent({
  name: 'Conductor',
  model: 'gpt-5-mini',
  instructions: 'Queue-driven conductor. See worker loop for logic.',
  tools: [],
});
