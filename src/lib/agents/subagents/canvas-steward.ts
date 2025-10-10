import { Agent, run, tool } from '@openai/agents';
import { z } from 'zod';
import {
  getCanvasSnapshot,
  summarizeCanvasSnapshot,
  getTranscriptWindow,
  type CanvasStateSummary,
} from '../shared/supabase-context';
import { broadcastToolCall } from '../shared/livekit-dispatch';

const logWithTs = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

const CanvasStateArgs = z.object({
  room: z.string().min(1),
  maxShapes: z.number().int().min(1).max(300).optional(),
  includeSnapshot: z.boolean().optional(),
});

const GetContextArgs = z.object({
  room: z.string().min(1),
  windowMs: z.number().int().min(1_000).max(600_000).nullable().optional(),
});

const SUPPORTED_CANVAS_TOOLS = [
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

const CanvasToolName = z.enum(SUPPORTED_CANVAS_TOOLS);

const ExecuteActionsArgs = z.object({
  room: z.string().min(1),
  actions: z
    .array(
      z.object({
        tool: CanvasToolName,
        params: z.record(z.any()).optional(),
        delayMs: z.number().int().min(0).max(5_000).optional(),
      }),
    )
    .min(1)
    .max(24),
});

type CanvasStateResult = { summary: CanvasStateSummary; snapshot?: Record<string, unknown> | null };

export const get_canvas_state = tool({
  name: 'get_canvas_state',
  description:
    'Summarize the TLDraw canvas for a room. Returns a lightweight list of shapes (id, type, text, approximate position).',
  parameters: CanvasStateArgs,
  async execute({ room, maxShapes, includeSnapshot }): Promise<CanvasStateResult> {
    const start = Date.now();
    const resolvedLimit = typeof maxShapes === 'number' ? maxShapes : 120;
    const record = await getCanvasSnapshot(room, resolvedLimit);
    const summary = summarizeCanvasSnapshot(record.snapshot, resolvedLimit);
    const duration = Date.now() - start;
    logWithTs('🖼️ [CanvasSteward] get_canvas_state', {
      room,
      shapes: summary.shapeCount,
      durationMs: duration,
    });
    return {
      summary,
      snapshot: includeSnapshot ? (record.snapshot as Record<string, unknown> | null) : undefined,
    };
  },
});

export const get_context = tool({
  name: 'get_context',
  description: 'Fetch recent transcript lines for a room.',
  parameters: GetContextArgs,
  async execute({ room, windowMs }) {
    const window = typeof windowMs === 'number' ? windowMs : 90_000;
    const start = Date.now();
    const transcript = await getTranscriptWindow(room, window);
    const duration = Date.now() - start;
    const lines = Array.isArray(transcript?.transcript) ? transcript.transcript.length : 0;
    logWithTs('🗒️ [CanvasSteward] get_context', { room, windowMs: window, lines, durationMs: duration });
    return transcript;
  },
});

export const execute_canvas_actions = tool({
  name: 'execute_canvas_actions',
  description:
    'Run one or more TLDraw canvas tools. Each action maps to a TLDraw event (e.g., canvas_create_rectangle, canvas_focus).',
  parameters: ExecuteActionsArgs,
  async execute({ room, actions }) {
    const executed: Array<{ tool: string }> = [];
    for (const action of actions) {
      await broadcastToolCall(room, {
        tool: action.tool,
        params: (action.params as Record<string, unknown> | undefined) ?? {},
        source: 'canvas-steward',
      });
      executed.push({ tool: action.tool });
      if (action.delayMs && action.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, action.delayMs));
      }
    }
    logWithTs('🛠️ [CanvasSteward] execute_canvas_actions', { room, count: executed.length });
    return { executed };
  },
});

export const CANVAS_STEWARD_INSTRUCTIONS = `You are the Canvas Steward, an expert TLDraw operator. Analyse the existing canvas with get_canvas_state and review the latest instructions with get_context when helpful. Plan your work, then call execute_canvas_actions with concrete drawing steps (create, move, align, colour). Keep updates concise and confirm once finished.`;

export const canvasSteward = new Agent({
  name: 'CanvasSteward',
  model: 'gpt-5-mini',
  instructions: CANVAS_STEWARD_INSTRUCTIONS,
  tools: [get_canvas_state, get_context, execute_canvas_actions],
});

export async function runCanvasSteward(params: { room: string; request: string; summary?: string }) {
  const { room, request, summary } = params;
  const promptPayload = {
    room,
    request,
    summary: summary?.slice(0, 500) || undefined,
  };
  const prompt = `Canvas request: ${JSON.stringify(promptPayload)}`;
  return run(canvasSteward, prompt);
}
