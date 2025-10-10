import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import {
  broadcastCanvasAction,
  CanvasShapeSummary,
  getCanvasShapeSummary,
  getTranscriptWindow,
} from '@/lib/agents/shared/supabase-context';

const logWithTs = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

const TOOL_PREFIX = 'canvas_';

const CanvasStateArgs = z.object({
  room: z.string().min(1),
});

const ContextArgs = z.object({
  room: z.string().min(1),
  windowMs: z.number().min(1_000).max(600_000).optional(),
});

const BroadcastArgs = z.object({
  room: z.string().min(1),
  tool: z.string().min(1),
  params: z.record(z.any()).optional(),
});

const ShapeActionArgs = z.object({
  room: z.string().min(1),
  params: z.record(z.any()).optional(),
});

const createCanvasTool = (name: string, description: string) =>
  tool({
    name: `${TOOL_PREFIX}${name}`,
    description,
    parameters: ShapeActionArgs,
    async execute({ room, params }) {
      const trimmedRoom = room.trim();
      if (!trimmedRoom) throw new Error('Room is required');
      const payloadParams = params ?? {};
      const toolName = `${TOOL_PREFIX}${name}`;
      await broadcastCanvasAction({ room: trimmedRoom, tool: toolName, params: payloadParams });
      logWithTs('🖌️ [CanvasSteward] action', { room: trimmedRoom, tool: toolName, params: payloadParams });
      return { status: 'OK' };
    },
  });

export const get_canvas_state = tool({
  name: 'get_canvas_state',
  description: 'Fetch a summary of TLDraw shapes for the room.',
  parameters: CanvasStateArgs,
  async execute({ room }) {
    const trimmedRoom = room.trim();
    const start = Date.now();
    const state = await getCanvasShapeSummary(trimmedRoom);
    logWithTs('🧾 [CanvasSteward] get_canvas_state', {
      room: trimmedRoom,
      durationMs: Date.now() - start,
      shapeCount: state.shapes.length,
    });
    return state as { version: number; shapes: CanvasShapeSummary[] };
  },
});

export const get_canvas_context = tool({
  name: 'get_canvas_context',
  description: 'Fetch recent transcript context to understand the request.',
  parameters: ContextArgs,
  async execute({ room, windowMs }) {
    const trimmedRoom = room.trim();
    const span = typeof windowMs === 'number' ? windowMs : 60_000;
    const start = Date.now();
    const context = await getTranscriptWindow(trimmedRoom, span);
    logWithTs('📝 [CanvasSteward] get_canvas_context', {
      room: trimmedRoom,
      windowMs: span,
      lines: Array.isArray(context?.transcript) ? context.transcript.length : 0,
      durationMs: Date.now() - start,
    });
    return context;
  },
});

export const dispatch_canvas_tool = tool({
  name: 'dispatch_canvas_tool',
  description: 'Broadcast a specific canvas tool event with parameters.',
  parameters: BroadcastArgs,
  async execute({ room, tool: targetTool, params }) {
    const trimmedRoom = room.trim();
    const toolName = targetTool.trim();
    if (!toolName.startsWith(TOOL_PREFIX)) {
      throw new Error(`Canvas tools must start with ${TOOL_PREFIX}`);
    }
    await broadcastCanvasAction({ room: trimmedRoom, tool: toolName, params });
    logWithTs('🛠️ [CanvasSteward] dispatch', { room: trimmedRoom, tool: toolName, params });
    return { status: 'OK' };
  },
});

const canvasToolDefinitions = [
  {
    name: 'create_rectangle',
    description:
      'Create a rectangle geo shape at the provided coordinates (x, y) with optional w/h/color.',
  },
  {
    name: 'create_ellipse',
    description:
      'Create an ellipse geo shape at the provided coordinates (x, y) with optional w/h/color.',
  },
  {
    name: 'create_note',
    description: 'Create a text sticky note near the viewport center. Params may include text.',
  },
  {
    name: 'create_arrow',
    description:
      'Create an arrow connecting shapes. Accepts { from, to, label } or start/end coordinates.',
  },
  {
    name: 'delete_shape',
    description: 'Remove shapes by id. Provide params.shapeIds = string[] to delete.',
  },
  {
    name: 'move_shape',
    description: 'Move shapes to coordinates. Provide params like { shapeId, x, y } or array.',
  },
  {
    name: 'resize_shape',
    description: 'Resize shapes. Provide params { shapeId, w, h } or array payload.',
  },
  {
    name: 'color_shape',
    description: 'Update color/fill of shapes. Params should include shapeId(s) and color info.',
  },
  {
    name: 'draw_smiley',
    description: 'Helper to draw a smiley face using primitive shapes.',
  },
  {
    name: 'focus',
    description: 'Focus the canvas viewport. Params depend on ToolDispatcher handler.',
  },
] as const;

const canvasTools = canvasToolDefinitions.reduce<Record<string, ReturnType<typeof createCanvasTool>>>(
  (acc, def) => {
    acc[def.name] = createCanvasTool(def.name, def.description);
    return acc;
  },
  {},
);

export const CANVAS_STEWARD_INSTRUCTIONS = `You are the Canvas Steward. Utilise the tools to inspect the TLDraw canvas, interpret the user's request, and manipulate shapes precisely.

Workflow:
1. Inspect the canvas state when needed using get_canvas_state.
2. Review recent conversation via get_canvas_context when context is unclear.
3. Plan your actions and apply them via the canvas_* tools. Prefer multiple discrete actions over large batches.
4. After completing changes, provide a short confirmation message describing the result.

Constraints:
- Execute real actions via tool calls; do not merely describe intent.
- Use only tools prefixed with canvas_. Ensure parameters are explicit.
- Preserve existing shapes unless instructed to modify or remove them.`;

export const canvasSteward = new Agent({
  name: 'CanvasSteward',
  model: 'gpt-5-mini',
  instructions: CANVAS_STEWARD_INSTRUCTIONS,
  tools: [
    get_canvas_state,
    get_canvas_context,
    dispatch_canvas_tool,
    ...Object.values(canvasTools),
  ],
});

export async function runCanvasSteward(params: { task: string; params: Record<string, unknown> }) {
  const { task, params: inputParams } = params;
  const prompt = `Handle ${task} with params: ${JSON.stringify(inputParams ?? {})}`;
  const start = Date.now();
  logWithTs('🚀 [CanvasSteward] run.start', { task, payloadKeys: Object.keys(inputParams || {}) });
  const result = await run(canvasSteward, prompt);
  try {
    logWithTs('✅ [CanvasSteward] run.complete', {
      task,
      durationMs: Date.now() - start,
      preview: typeof result.finalOutput === 'string' ? result.finalOutput.slice(0, 160) : null,
    });
  } catch {}
  return result;
}
