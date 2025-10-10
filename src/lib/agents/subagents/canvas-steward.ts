import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import { getCanvasSummary, getTranscriptWindow } from '../shared/supabase-context';

const logWithTs = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

const CANVAS_ACTIONS = [
  'canvas_focus',
  'canvas_zoom_all',
  'canvas_create_note',
  'canvas_pin_selected',
  'canvas_unpin_selected',
  'canvas_lock_selected',
  'canvas_unlock_selected',
  'canvas_arrange_grid',
  'canvas_create_rectangle',
  'canvas_create_ellipse',
  'canvas_align_selected',
  'canvas_distribute_selected',
  'canvas_draw_smiley',
  'canvas_toggle_grid',
  'canvas_set_background',
  'canvas_set_theme',
  'canvas_select',
  'canvas_select_by_note',
  'canvas_color_shape',
  'canvas_delete_shape',
  'canvas_rename_note',
  'canvas_connect_shapes',
  'canvas_label_arrow',
  'canvas_list_shapes',
] as const;

const GetCanvasStateArgs = z.object({
  room: z.string(),
  limit: z.number().min(1).max(200).nullable().optional(),
});

const GetContextArgs = z.object({
  room: z.string(),
  windowMs: z.number().min(1000).max(600000).nullable(),
});

const DispatchCanvasActionArgs = z.object({
  room: z.string(),
  action: z.enum(CANVAS_ACTIONS),
  params: z.record(z.any()).optional(),
  rationale: z.string().optional(),
});

const resolveDispatchUrl = () => {
  const derivedPort = process.env.PORT || process.env.NEXT_PUBLIC_PORT;
  const derivedLocal =
    derivedPort && Number.isFinite(Number(derivedPort)) ? `http://127.0.0.1:${derivedPort}` : undefined;
  const candidates = [
    process.env.STEWARD_DISPATCH_BASE_URL,
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

export const get_canvas_state = tool({
  name: 'get_canvas_state',
  description: 'Summarize the TLDraw canvas for a room (shape ids, types, and key props).',
  parameters: GetCanvasStateArgs,
  async execute({ room, limit }) {
    const start = Date.now();
    const summary = await getCanvasSummary(room, { limit: limit ?? undefined });
    try {
      logWithTs('🖼️ [CanvasSteward] get_canvas_state', {
        room,
        shapes: summary.totalShapes,
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

export const dispatch_canvas_action = tool({
  name: 'dispatch_canvas_action',
  description:
    'Dispatch a TLDraw canvas action (shape creation, alignment, selection, styling) via LiveKit broadcast.',
  parameters: DispatchCanvasActionArgs,
  async execute({ room, action, params, rationale }) {
    const url = resolveDispatchUrl();
    if (!url) {
      throw new Error('DISPATCH_UNAVAILABLE');
    }

    const payload = {
      room,
      tool: action,
      params: params ?? {},
      rationale,
    };

    const start = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, source: 'steward:canvas' }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DISPATCH_FAILED: ${res.status} ${text}`);
    }
    try {
      logWithTs('🎯 [CanvasSteward] dispatch_canvas_action', {
        room,
        action,
        durationMs: Date.now() - start,
      });
    } catch {}
    return { status: 'QUEUED', action };
  },
});

export const CANVAS_STEWARD_INSTRUCTIONS =
  'You are the TLDraw canvas steward. Observe the current canvas, plan, then apply precise actions. Use get_canvas_state to see existing shapes, get_context for recent speech, and dispatch_canvas_action for each canvas update. Always include the provided room when using tools. Keep responses short and confirm once work is complete.';

export const canvasSteward = new Agent({
  name: 'CanvasSteward',
  model: 'gpt-5-mini',
  instructions: CANVAS_STEWARD_INSTRUCTIONS,
  tools: [get_canvas_state, get_context, dispatch_canvas_action],
});

export async function runCanvasSteward(params: {
  room: string;
  task: string;
  payload?: Record<string, unknown>;
}) {
  const { room, task, payload } = params;
  const windowMs = typeof payload?.windowMs === 'number' ? payload.windowMs : undefined;
  const overallStart = Date.now();
  try {
    logWithTs('🚀 [CanvasSteward] run.start', {
      room,
      task,
      windowMs,
    });
  } catch {}

  const prompt = `Canvas task ${task} for room ${room}. Parameters: ${JSON.stringify(payload ?? {})}`;
  const result = await run(canvasSteward, prompt);

  try {
    logWithTs('✅ [CanvasSteward] run.complete', {
      room,
      task,
      durationMs: Date.now() - overallStart,
    });
  } catch {}

  return result.finalOutput;
}
