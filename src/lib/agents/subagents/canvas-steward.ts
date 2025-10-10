import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { getCanvasState, getTranscriptWindow } from '../shared/supabase-context';

type CanvasActionResult = { id?: string; status?: string } | Record<string, unknown>;

const logWithTs = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

const resolveDispatchUrl = () => {
  const derivedPort = process.env.PORT || process.env.NEXT_PUBLIC_PORT;
  const derivedLocal =
    derivedPort && Number.isFinite(Number(derivedPort))
      ? `http://127.0.0.1:${derivedPort}`
      : undefined;
  const candidates = [
    process.env.CANVAS_STEWARD_DISPATCH_URL,
    process.env.STEWARD_COMMIT_BASE_URL,
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

const GetCanvasStateArgs = z.object({
  room: z.string(),
  includeSnapshot: z.boolean().optional(),
});

export const get_canvas_state = tool({
  name: 'get_canvas_state',
  description: 'Fetch a summary of the current TLDraw canvas including shapes and metadata.',
  parameters: GetCanvasStateArgs,
  async execute({ room, includeSnapshot }) {
    const start = Date.now();
    const state = await getCanvasState(room);
    const histogram = state.shapes.reduce<Record<string, number>>((acc, shape) => {
      const key = shape.type || 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const summary = {
      canvasId: state.canvasId ?? null,
      name: state.name ?? null,
      lastModified: state.lastModified ?? null,
      shapeCount: state.shapes.length,
      typeHistogram: histogram,
      shapes: state.shapes.slice(0, 200),
    } as Record<string, unknown>;
    if (includeSnapshot) {
      summary.snapshot = state.snapshot ?? null;
    }
    try {
      logWithTs('🖼️ [CanvasSteward] get_canvas_state', {
        room,
        shapeCount: state.shapes.length,
        durationMs: Date.now() - start,
      });
    } catch {}
    return summary;
  },
});

const GetContextArgs = z.object({
  room: z.string(),
  windowMs: z.number().min(1_000).max(600_000).nullable().optional(),
});

export const get_context = tool({
  name: 'get_context',
  description: 'Fetch recent transcript lines for a room.',
  parameters: GetContextArgs,
  async execute({ room, windowMs }) {
    const spanMs = typeof windowMs === 'number' && Number.isFinite(windowMs) ? windowMs : 60_000;
    const start = Date.now();
    const window = await getTranscriptWindow(room, spanMs);
    try {
      logWithTs('📝 [CanvasSteward] get_context', {
        room,
        windowMs: spanMs,
        lines: Array.isArray(window?.transcript) ? window.transcript.length : 0,
        durationMs: Date.now() - start,
      });
    } catch {}
    return window;
  },
});

const CanvasActionArgs = z
  .object({
    room: z.string(),
    params: z.record(z.any()).optional(),
  })
  .catchall(z.any());

const sanitizeParams = (payload: Record<string, unknown>) => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (key === 'room') continue;
    result[key] = value;
  }
  return result;
};

const dispatchCanvasTool = async (room: string, toolName: string, params: Record<string, unknown>) => {
  const trimmedRoom = room.trim();
  if (!trimmedRoom) {
    throw new Error('MISSING_ROOM');
  }
  const normalizedParams = sanitizeParams(params);
  const url = resolveDispatchUrl();
  if (!url) {
    throw new Error('DISPATCH_URL_UNAVAILABLE');
  }
  const payload = {
    room: trimmedRoom,
    tool: toolName,
    params: normalizedParams,
    source: 'canvas-steward',
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DISPATCH_FAILED:${response.status}:${text}`);
  }
  try {
    const data = (await response.json().catch(() => ({}))) as CanvasActionResult;
    return data;
  } catch {
    return { status: 'ok' };
  }
};

const createCanvasActionTool = (name: string, description: string) =>
  tool({
    name,
    description,
    parameters: CanvasActionArgs,
    async execute(args) {
      const { room, params, ...rest } = args as {
        room: string;
        params?: Record<string, unknown>;
        [key: string]: unknown;
      };
      const merged = {
        ...(params && typeof params === 'object' && !Array.isArray(params) ? params : {}),
        ...rest,
      };
      const result = await dispatchCanvasTool(room, name, merged);
      try {
        logWithTs('🖊️ [CanvasSteward] action dispatched', {
          room,
          tool: name,
          keys: Object.keys(merged),
        });
      } catch {}
      return {
        status: 'DISPATCHED',
        room,
        tool: name,
        params: sanitizeParams(merged),
        result,
      };
    },
  });

const canvasActionTools = [
  createCanvasActionTool(
    'canvas_create_rectangle',
    'Create a rectangle (geo) shape. Provide optional x, y, w, h, or style fields.',
  ),
  createCanvasActionTool(
    'canvas_create_ellipse',
    'Create an ellipse (geo) shape. Provide optional x, y, w, h, or style fields.',
  ),
  createCanvasActionTool('canvas_create_note', 'Create a TLDraw note with optional text.'),
  createCanvasActionTool('canvas_draw_smiley', 'Draw a friendly smiley face near the viewport center.'),
  createCanvasActionTool('canvas_focus', 'Focus or zoom the canvas to a target selection or bounds.'),
  createCanvasActionTool('canvas_zoom_all', 'Zoom out to show the entire canvas.'),
  createCanvasActionTool(
    'canvas_arrange_grid',
    'Arrange selected shapes (or all custom shapes) into a tidy grid. Accepts spacing and cols.',
  ),
  createCanvasActionTool(
    'canvas_align_selected',
    'Align the current selection. Provide axis ("x" or "y") and mode (left/right/center/top/bottom/middle).',
  ),
  createCanvasActionTool(
    'canvas_distribute_selected',
    'Distribute selected shapes evenly along an axis. Provide axis "x" or "y".',
  ),
  createCanvasActionTool(
    'canvas_select',
    'Select shapes by filters (nameContains, type, withinBounds) and optionally zoom to them.',
  ),
  createCanvasActionTool(
    'canvas_select_by_note',
    'Select the first note whose text contains the query string.',
  ),
  createCanvasActionTool(
    'canvas_color_shape',
    'Recolor a note. Provide shapeId (or selection hints) and a TLDraw note color value.',
  ),
  createCanvasActionTool('canvas_rename_note', 'Rename a note by shapeId (or selection hints) and new text.'),
  createCanvasActionTool('canvas_delete_shape', 'Delete a target shape. Provide shapeId or selection hints.'),
  createCanvasActionTool('canvas_toggle_grid', 'Toggle the background grid overlay.'),
  createCanvasActionTool('canvas_set_background', 'Set the canvas background color or style.'),
  createCanvasActionTool('canvas_set_theme', 'Switch between light/dark canvas themes.'),
  createCanvasActionTool('canvas_pin_selected', 'Pin selected shapes in place.'),
  createCanvasActionTool('canvas_unpin_selected', 'Unpin selected shapes.'),
  createCanvasActionTool('canvas_lock_selected', 'Lock the current selection to prevent edits.'),
  createCanvasActionTool('canvas_unlock_selected', 'Unlock the current selection.'),
];

export const CANVAS_STEWARD_INSTRUCTIONS = `You are the Canvas Steward. Inspect the TLDraw canvas and execute drawing or layout tasks.
Follow this loop:
1. Observe the existing canvas (get_canvas_state) and transcript context (get_context) when needed.
2. Plan succinctly, then perform concrete actions with the canvas_* tools. Always create or update shapes instead of describing them.
3. Keep updates deterministic and visible. When finished, respond with a short confirmation of the changes made.`;

export const canvasSteward = new Agent({
  name: 'CanvasSteward',
  model: 'gpt-5-mini',
  instructions: CANVAS_STEWARD_INSTRUCTIONS,
  tools: [get_canvas_state, get_context, ...canvasActionTools],
});

export async function runCanvasSteward(params: {
  room: string;
  request?: string;
  goal?: string;
  windowMs?: number;
}) {
  const windowMs = params.windowMs ?? 60_000;
  const { room, request, goal } = params;
  try {
    logWithTs('🚀 [CanvasSteward] run.start', { room, windowMs, hasRequest: Boolean(request || goal) });
  } catch {}
  const promptPayload = {
    room,
    request: request ?? goal ?? null,
    windowMs,
  };
  const prompt = `Run canvas steward with context: ${JSON.stringify(promptPayload)}`;
  const result = await run(canvasSteward, prompt);
  try {
    const preview = typeof result.finalOutput === 'string' ? result.finalOutput.slice(0, 160) : null;
    logWithTs('✅ [CanvasSteward] run.complete', {
      room,
      durationMs: result.metrics?.total_time_ms ?? null,
      preview,
    });
  } catch {}
  return result.finalOutput;
}
