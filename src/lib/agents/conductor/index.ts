import { Agent, run, tool } from '@openai/agents';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { jsonObjectSchema, type JsonObject } from '@/lib/utils/json-schema';
import {
  broadcastAgentPrompt,
  type CanvasAgentPromptPayload,
} from '@/lib/agents/shared/supabase-context';
import { activeFlowchartSteward } from '../subagents/flowchart-steward-registry';
import { runCanvasSteward } from '../subagents/canvas-steward';

// Thin router: receives dispatch_to_conductor and hands off to stewards
const SERVER_CANVAS_EXECUTION_ENABLED = process.env.CANVAS_STEWARD_SERVER_EXECUTION === 'true';

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

export async function dispatchConductorTask(task: string, params: JsonObject) {
  if (task.startsWith('flowchart.')) {
    const result = await run(activeFlowchartSteward, JSON.stringify({ task, params }));
    return result.finalOutput;
  }

  if (task === 'canvas.agent_prompt') {
    const promptResult = await handleCanvasAgentPrompt(params);
    if (!SERVER_CANVAS_EXECUTION_ENABLED) {
      return promptResult;
    }
    const stewardParams: JsonObject = {
      ...params,
      room: promptResult.room,
      message: promptResult.payload.message,
      requestId: promptResult.payload.requestId,
      bounds: promptResult.payload.bounds ?? undefined,
      selectionIds: promptResult.payload.selectionIds ?? undefined,
      metadata: promptResult.payload.metadata ?? undefined,
    };
    const stewardResult = await runCanvasSteward({ task, params: stewardParams });
    return { ...promptResult, steward: stewardResult };
  }

  if (task.startsWith('canvas.')) {
    if (!SERVER_CANVAS_EXECUTION_ENABLED) {
      throw new Error(`Canvas steward server execution disabled for task: ${task}`);
    }
    return runCanvasSteward({ task, params });
  }

  throw new Error(`No steward for task: ${task}`);
}

const dispatchToConductor = tool({
  name: 'dispatch_to_conductor',
  description: 'Ask the Conductor to run a steward for a complex component/task.',
  parameters: z.object({
    task: z.string().describe('Task identifier, e.g., flowchart.update'),
    params: jsonObjectSchema.describe('Task parameters').default({}),
  }),
  async execute({ task, params }: { task: string; params: JsonObject }) {
    return dispatchConductorTask(task, params);
  },
});

export const conductor = new Agent({
  name: 'Conductor',
  model: 'gpt-5-mini',
  instructions:
    'You are the Conductor. You own no business logic. When asked, hand off to the correct steward and return their final output.',
  tools: [dispatchToConductor],
});

export async function callConductor(task: string, params: JsonObject) {
  return dispatchConductorTask(task, params);
}

// Simple CLI to keep the process alive for local dev
const isDirectExecution =
  import.meta.url.startsWith('file:') &&
  typeof process.argv[1] === 'string' &&
  /index\.(ts|js)$/.test(process.argv[1]);

if (isDirectExecution) {
  console.log('[Conductor] Ready. Waiting for handoffs...');
  setInterval(() => {}, 1 << 30);
}
