import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { getCanvasSummary, getTranscriptWindow } from '../shared/supabase-context';

const logWithTs = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

const GetCanvasStateArgs = z.object({
  room: z.string(),
  maxShapes: z.number().int().min(1).max(200).nullable(),
});

const GetContextArgs = z.object({
  room: z.string(),
  windowMs: z.number().min(1000).max(600000).nullable(),
});

const CanvasActionArgs = z.object({
  room: z.string(),
  payload: z.record(z.any()).nullable(),
});

const resolveDispatchUrl = () => {
  const derivedPort = process.env.PORT || process.env.NEXT_PUBLIC_PORT;
  const derivedLocal =
    derivedPort && Number.isFinite(Number(derivedPort)) ? `http://127.0.0.1:${derivedPort}` : undefined;
  const candidates = [
    process.env.STEWARD_DISPATCH_BASE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.BASE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    derivedLocal,
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3000',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const normalized = candidate.startsWith('http') ? candidate : `https://${candidate}`;
      return new URL('/api/steward/dispatch', normalized).toString();
    } catch {
      continue;
    }
  }
  return null;
};

const dispatchCanvasTool = async (room: string, toolName: string, payload: Record<string, unknown>) => {
  const url = resolveDispatchUrl();
  if (!url) {
    throw new Error('DISPATCH_URL_UNAVAILABLE');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room, tool: toolName, params: payload }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to dispatch canvas tool (${res.status})`);
  }
};

export const get_canvas_state = tool({
  name: 'get_canvas_state',
  description: 'Fetch a lightweight summary of the current TLDraw canvas for a room.',
  parameters: GetCanvasStateArgs,
  async execute({ room, maxShapes }) {
    const start = Date.now();
    const summary = await getCanvasSummary(room, { maxShapes });
    try {
      logWithTs('🖼️ [CanvasSteward] get_canvas_state', {
        room,
        shapes: summary.totalShapes,
        returned: summary.shapes.length,
        durationMs: Date.now() - start,
      });
    } catch {}
    return summary;
  },
});

export const get_context = tool({
  name: 'get_context',
  description: 'Fetch recent transcript lines for a room.',
  parameters: GetContextArgs,
  async execute({ room, windowMs }) {
    const spanMs = typeof windowMs === 'number' ? windowMs : 60000;
    const start = Date.now();
    const window = await getTranscriptWindow(room, spanMs);
    try {
      const count = Array.isArray(window?.transcript) ? window.transcript.length : 0;
      logWithTs('📝 [CanvasSteward] get_context', {
        room,
        windowMs: spanMs,
        lines: count,
        durationMs: Date.now() - start,
      });
    } catch {}
    return window;
  },
});

const canvasActionDefinitions: Array<{ name: string; description: string }> = [
  { name: 'canvas_focus', description: 'Center the viewport on the primary focus of the drawing.' },
  { name: 'canvas_zoom_all', description: 'Zoom to fit all visible shapes.' },
  { name: 'canvas_create_note', description: 'Create a sticky note with optional text in the current viewport.' },
  { name: 'canvas_pin_selected', description: 'Pin the currently selected shapes to prevent accidental movement.' },
  { name: 'canvas_unpin_selected', description: 'Unpin the selected shapes.' },
  { name: 'canvas_lock_selected', description: 'Lock the selected shapes.' },
  { name: 'canvas_unlock_selected', description: 'Unlock the selected shapes.' },
  { name: 'canvas_arrange_grid', description: 'Arrange the current selection into a tidy grid.' },
  { name: 'canvas_create_rectangle', description: 'Create a rectangle; accepts x, y, w, h props for placement.' },
  { name: 'canvas_create_ellipse', description: 'Create an ellipse; accepts x, y, w, h props for placement.' },
  { name: 'canvas_align_selected', description: 'Align selected shapes using direction parameters (e.g., { direction: "left" }).' },
  { name: 'canvas_distribute_selected', description: 'Distribute selected shapes evenly along an axis.' },
  { name: 'canvas_draw_smiley', description: 'Draw a playful smiley face illustration.' },
  { name: 'canvas_toggle_grid', description: 'Toggle grid visibility on the canvas.' },
  { name: 'canvas_set_background', description: 'Set the canvas background color.' },
  { name: 'canvas_set_theme', description: 'Switch between light/dark or themed palettes.' },
  { name: 'canvas_select', description: 'Select shapes by ids or predicates.' },
  { name: 'canvas_select_by_note', description: 'Select notes that match given text.' },
  { name: 'canvas_color_shape', description: 'Color a shape; expects shapeId and style parameters.' },
  { name: 'canvas_delete_shape', description: 'Delete one or more shapes by id.' },
  { name: 'canvas_rename_note', description: 'Rename a note by id.' },
  { name: 'canvas_connect_shapes', description: 'Create a connector or arrow between shapes.' },
  { name: 'canvas_label_arrow', description: 'Add or update the label on a connector arrow.' },
];

const canvasActionTools = canvasActionDefinitions.map(({ name, description }) =>
  tool({
    name,
    description,
    parameters: CanvasActionArgs,
    async execute({ room, payload }) {
      const normalized = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
      try {
        logWithTs('🎯 [CanvasSteward] dispatch', { room, tool: name, payload: normalized });
      } catch {}
      await dispatchCanvasTool(room, name, normalized);
      return { ok: true };
    },
  }),
);

export const CANVAS_STEWARD_INSTRUCTIONS = `You are the Canvas Steward, an expert TLDraw operator.
Always inspect the current canvas with get_canvas_state before making large edits.
Use get_context when you need to reference recent instructions.
Plan briefly, then execute your plan by calling the canvas_* tools.
Return a short confirmation once complete.`;

export const canvasSteward = new Agent({
  name: 'CanvasSteward',
  model: 'gpt-5-mini',
  instructions: CANVAS_STEWARD_INSTRUCTIONS,
  tools: [get_canvas_state, get_context, ...canvasActionTools],
});

export async function runCanvasSteward(params: {
  room: string;
  request: string;
  task?: string;
  windowMs?: number;
  maxShapes?: number;
  rawParams?: Record<string, unknown>;
}) {
  const { room, request, task, windowMs, maxShapes, rawParams } = params;
  const normalizedRoom = room.trim();
  const overallStart = Date.now();
  try {
    logWithTs('🚀 [CanvasSteward] run.start', {
      room: normalizedRoom,
      task: task ?? 'canvas.draw',
      windowMs: windowMs ?? null,
      maxShapes: maxShapes ?? null,
    });
  } catch {}

  const payload = {
    task: task ?? 'canvas.draw',
    room: normalizedRoom,
    request,
    windowMs: windowMs ?? null,
    maxShapes: maxShapes ?? null,
    rawParams: rawParams ?? null,
  };

  const prompt = `Handle ${payload.task} for room ${payload.room} with request: ${request}.`;
  const result = await run(canvasSteward, prompt);

  try {
    logWithTs('✅ [CanvasSteward] run.complete', {
      room: normalizedRoom,
      task: payload.task,
      durationMs: Date.now() - overallStart,
      preview: typeof result.finalOutput === 'string' ? result.finalOutput.slice(0, 160) : null,
    });
  } catch {}

  return result.finalOutput;
}
