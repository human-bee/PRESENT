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
import { runCanvasSteward } from '../subagents/canvas-steward';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { resolveIntent, getObject, getString } from './intent-resolver';
import { runDebateScorecardSteward } from '@/lib/agents/debate-judge';

// Thin router: receives dispatch_to_conductor and hands off to stewards
const SERVER_CANVAS_EXECUTION_ENABLED = process.env.CANVAS_STEWARD_SERVER_EXECUTION === 'true';
const TASK_LEASE_TTL_MS = Number(process.env.TASK_LEASE_TTL_MS ?? 15_000);
const ROOM_CONCURRENCY = Number(process.env.ROOM_CONCURRENCY ?? 2);
const queue = new AgentTaskQueue();

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

const ScorecardTaskArgs = z
  .object({
    room: z.string().min(1, 'room is required'),
    componentId: z.string().min(1, 'componentId is required'),
    windowMs: z.number().min(1_000).max(600_000).optional(),
    intent: z.string().optional(),
    summary: z.string().optional(),
    prompt: z.string().optional(),
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
    console.log('[Conductor] dispatch_to_conductor routed', {
      nextTask,
      hasPayload: payload != null,
    });
    return executeTask(nextTask, payload ?? {});
  }

  if (taskName.startsWith('flowchart.')) {
    const result = await run(activeFlowchartSteward, JSON.stringify({ task: taskName, params }));
    return result.finalOutput;
  }

  if (taskName.startsWith('scorecard.')) {
    const parsed = ScorecardTaskArgs.parse(params);
    console.log('[Conductor] dispatching scorecard task', {
      taskName,
      room: parsed.room,
      componentId: parsed.componentId,
      intent: parsed.intent ?? taskName,
    });
    const output = await runDebateScorecardSteward({
      room: parsed.room,
      componentId: parsed.componentId,
      windowMs: parsed.windowMs,
      intent: parsed.intent ?? taskName,
      summary: parsed.summary,
      prompt: parsed.prompt,
    });
    console.log('[Conductor] scorecard steward completed', {
      taskName,
      room: parsed.room,
      componentId: parsed.componentId,
      ok: true,
    });
    return { status: 'completed', output };
  }

  if (taskName === 'canvas.agent_prompt') {
    const promptResult = await handleCanvasAgentPrompt(params);
    if (!SERVER_CANVAS_EXECUTION_ENABLED) {
      return promptResult;
    }
    const stewardParams: JsonObject = {
      ...params,
      room: promptResult.room,
      message: promptResult.payload.message,
      requestId: promptResult.payload.requestId,
      metadata: promptResult.payload.metadata ?? undefined,
    };
    // Execute via Canvas Steward on the server to ensure action even without a client host
    await runCanvasSteward({ task: 'canvas.agent_prompt', params: stewardParams });
    return { ...promptResult, status: 'queued' };
  }

  if (taskName.startsWith('canvas.')) {
    if (!SERVER_CANVAS_EXECUTION_ENABLED) {
      throw new Error(`Canvas steward server execution disabled for task: ${taskName}`);
    }
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

function createLeaseExtender(taskId: string, leaseToken: string) {
  const intervalMs = Math.max(1_000, Math.floor(TASK_LEASE_TTL_MS * 0.6));
  let stopped = false;

  const intervalId = setInterval(() => {
    if (stopped) return;
    void queue.extendLease(taskId, leaseToken, TASK_LEASE_TTL_MS).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[Conductor] failed to extend lease', { taskId, error: message });
    });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

async function workerLoop() {
  while (true) {
    const { leaseToken, tasks } = await queue.claimTasks({
      limit: Number(process.env.TASK_DEFAULT_CONCURRENCY ?? 10),
      leaseTtlMs: TASK_LEASE_TTL_MS,
    });

    if (tasks.length === 0) {
      await delay(500);
      continue;
    }

    console.log('[Conductor] claimed tasks', {
      count: tasks.length,
      taskNames: tasks.map((task) => task.task),
    });

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
            const stopLeaseExtender = createLeaseExtender(task.id, leaseToken);
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
            } finally {
              stopLeaseExtender();
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
