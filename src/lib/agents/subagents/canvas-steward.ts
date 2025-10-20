import { z } from 'zod';
import {
  broadcastCanvasAction,
  CanvasShapeSummary,
  getCanvasShapeSummary,
  getTranscriptWindow,
} from '@/lib/agents/shared/supabase-context';
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from '@/lib/utils/json-schema';
import { getCanvasAgentService, type CanvasPlan } from './canvas-agent-service';
import { resolveCanvasModelName } from './canvas-models';

const logWithTs = <T extends Record<string, unknown>>(label: string, payload: T) => {
  try {
    console.log(label, { ts: new Date().toISOString(), ...payload });
  } catch {}
};

const CANVAS_STEWARD_DEBUG = process.env.CANVAS_STEWARD_DEBUG === 'true';
const debugLog = (...args: unknown[]) => {
  if (CANVAS_STEWARD_DEBUG) {
    try {
      console.log('[CanvasSteward]', ...args);
    } catch {}
  }
};
const debugJson = (label: string, value: unknown, max = 2000) => {
  if (!CANVAS_STEWARD_DEBUG) return;
  try {
    const json = JSON.stringify(value, null, 2);
    debugLog(label, json.length > max ? `${json.slice(0, max)}… (truncated ${json.length - max} chars)` : json);
  } catch (error) {
    debugLog(label, value);
  }
};

const ParamEntry = z.object({
  key: z.string(),
  value: jsonValueSchema,
});
type ParamEntryType = z.infer<typeof ParamEntry>;

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

const CANVAS_STEWARD_SYSTEM_PROMPT = `You are the Creative Canvas Steward. You receive the TLDraw canvas state, recent conversation context, and a user request. Plan and execute changes by emitting structured tool actions.

Always respond with JSON matching the provided schema:
- "actions": array of one or more objects with "tool" and "params".
  - "tool" must start with "canvas_".
  - "params" is an object whose keys map to the ToolDispatcher payload.
- "summary": short confirmation of what changed.

Rules:
- Only use the listed canvas_* tools. Do not invent tool names or parameters.
- Be precise: convert numeric strings to numbers when needed.
- If unsure, make a reasonable, safe change rather than returning no actions.
- Preserve existing shapes unless asked to modify or remove them.`;

type RunCanvasStewardArgs = {
  task: string;
  params: JsonObject | ParamEntryType[];
};

export async function runCanvasSteward(args: RunCanvasStewardArgs) {
  const { task, params } = args;
  const normalizedEntries = objectToEntries(params);
  const payload = jsonObjectSchema.parse(entriesToObject(normalizedEntries));
  const room = extractRoom(payload);
  const windowMs = resolveWindowMs(payload);
  const allowOverride =
    payload.allowModelOverride === true ||
    payload.modelOverride === true ||
    payload.model_override === true;
  const modelName = resolveCanvasModelName({ explicit: payload.model, allowOverride });

  const taskLabel = task.startsWith('canvas.') ? task.slice('canvas.'.length) : task;
  const start = Date.now();

  const [canvasState, context] = await Promise.all([
    getCanvasShapeSummary(room),
    windowMs ? getTranscriptWindow(room, windowMs) : Promise.resolve<{ transcript?: unknown[] }>({}),
  ]);

  const prompt = buildPrompt({
    task,
    taskLabel,
    room,
    payload,
    canvasState,
    transcript:
      Array.isArray(context?.transcript) && context.transcript.length > 0
        ? context.transcript
        : undefined,
  });

  logWithTs('🚀 [CanvasSteward] run.start', {
    task,
    modelName,
    room,
    payloadKeys: Object.keys(payload),
    shapeCount: canvasState.shapes.length,
    transcriptLines: Array.isArray(context?.transcript) ? context.transcript.length : 0,
  });
  debugLog('promptPreview', prompt.slice(0, 400));
  debugJson('promptPayload', payload);
  debugJson('promptContext', {
    canvasState: {
      version: canvasState.version,
      shapeSample: canvasState.shapes.slice(0, 5),
      totalShapes: canvasState.shapes.length,
    },
    transcriptSample: Array.isArray(context?.transcript) ? context.transcript.slice(-10) : undefined,
  });

  const service = getCanvasAgentService();
  const { plan, modelName: resolvedModelName } = await service.generatePlan({
    modelName,
    system: CANVAS_STEWARD_SYSTEM_PROMPT,
    prompt,
  });

  debugLog('plan.received', {
    actions: plan.actions.length,
    summary: plan.summary,
  });
  debugJson('plan.actions', plan.actions);

  await applyCanvasPlan(room, plan);

  try {
    logWithTs('✅ [CanvasSteward] run.complete', {
      task,
      modelName: resolvedModelName,
      room,
      actionCount: plan.actions.length,
      durationMs: Date.now() - start,
      summaryPreview: plan.summary.slice(0, 160),
    });
  } catch {}

  return plan.summary;
}

function extractRoom(payload: JsonObject): string {
  const raw = payload.room;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  throw new Error('Canvas steward requires a room parameter');
}

function resolveWindowMs(payload: JsonObject): number | null {
  const raw = payload.windowMs ?? payload.window_ms ?? null;
  const value =
    typeof raw === 'string'
      ? Number.parseInt(raw, 10)
      : typeof raw === 'number'
        ? raw
        : null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1_000 && value <= 600_000) {
    return value;
  }
  return 60_000;
}

function buildPrompt(options: {
  task: string;
  taskLabel: string;
  room: string;
  payload: JsonObject;
  canvasState: { version: number; shapes: CanvasShapeSummary[] };
  transcript?: unknown[];
}) {
  const { task, taskLabel, room, payload, canvasState, transcript } = options;
  const shapesPreview = canvasState.shapes.slice(0, 60);
  const shapesMore = canvasState.shapes.length - shapesPreview.length;
  const transcriptLines = Array.isArray(transcript)
    ? transcript.slice(-20).map((line) => {
        if (typeof line === 'string') return line;
        if (line && typeof line === 'object' && 'text' in (line as Record<string, unknown>)) {
          return String((line as Record<string, unknown>).text ?? '');
        }
        return JSON.stringify(line);
      })
    : [];

  const toolSummary = canvasToolDefinitions
    .map((def) => `- canvas_${def.name}: ${def.description}`)
    .join('\n');

  const contentSections = [
    `Task: ${task} (${taskLabel})`,
    `Room: ${room}`,
    `Input parameters:\n${formatJson(payload)}`,
    `Canvas state (version ${canvasState.version}, showing ${shapesPreview.length}${
      shapesMore > 0 ? ` of ${canvasState.shapes.length}` : ''
    } shapes):\n${formatJson(shapesPreview)}`,
  ];

  if (transcriptLines.length > 0) {
    contentSections.push(`Recent transcript (latest first):\n${transcriptLines.join('\n')}`);
  }

  contentSections.push(`Available canvas tools:\n${toolSummary}`);
  contentSections.push(
    'Plan concrete actions and respond with JSON matching the schema (no additional text).',
  );

  return contentSections.join('\n\n');
}

async function applyCanvasPlan(room: string, plan: CanvasPlan) {
  if (plan.actions.length === 0) {
    debugLog('plan.actions empty – nothing to apply', { room, summary: plan.summary });
    return;
  }

  for (const action of plan.actions) {
    const tool = action.tool.trim();
    if (!tool.startsWith('canvas_')) {
      throw new Error(`Invalid canvas tool: ${tool}`);
    }
    const params = jsonObjectSchema.parse(action.params ?? {});
    debugLog('plan.action', { room, tool, params, rationale: action.rationale });
    await broadcastCanvasAction({ room, tool, params });
    try {
      logWithTs('🖌️ [CanvasSteward] action', {
        room,
        tool,
        params,
        rationale: action.rationale,
      });
    } catch {}
  }
}

const entriesToObject = (entries: ParamEntryType[]) =>
  Object.fromEntries((entries ?? []).map(({ key, value }) => [key, value]));

const objectToEntries = (obj: JsonObject | ParamEntryType[] | undefined): ParamEntryType[] => {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj as ParamEntryType[];
  return Object.entries(obj)
    .filter(([, value]) => typeof value !== 'undefined')
    .map(([key, value]) => ParamEntry.parse({ key, value: value as JsonValue }));
};

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
