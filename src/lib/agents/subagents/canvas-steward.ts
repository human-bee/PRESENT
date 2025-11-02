import { z } from 'zod';
import {
  getCanvasShapeSummary,
  getTranscriptWindow,
} from '@/lib/agents/shared/supabase-context';
import { jsonObjectSchema, jsonValueSchema, type JsonObject, type JsonValue } from '@/lib/utils/json-schema';
import { runCanvasAgent } from '@/lib/agents/canvas-agent/server/runner';

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

type RunCanvasStewardArgs = {
  task: string;
  params: JsonObject | ParamEntryType[];
};

export async function runCanvasSteward(args: RunCanvasStewardArgs) {
  const { task, params } = args;
  const normalizedEntries = objectToEntries(params);
  const payload = jsonObjectSchema.parse(entriesToObject(normalizedEntries));
  const room = extractRoom(payload);
  const message = extractMessage(payload);
  const model = typeof payload.model === 'string' ? payload.model : undefined;

  const taskLabel = task.startsWith('canvas.') ? task.slice('canvas.'.length) : task;
  const start = Date.now();

  logWithTs('🚀 [CanvasSteward] run.start', {
    task,
    taskLabel,
    room,
    message: message.slice(0, 100),
  });

  try {
    // Call unified Canvas Agent server runner
    await runCanvasAgent({
      roomId: room,
      userMessage: message,
      model,
      initialViewport: payload.bounds as any,
    });

    logWithTs('✅ [CanvasSteward] run.complete', {
      task,
      room,
      durationMs: Date.now() - start,
    });

    return 'Canvas agent executed';
  } catch (error) {
    logWithTs('❌ [CanvasSteward] run.error', {
      task,
      room,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function extractRoom(payload: JsonObject): string {
  const raw = payload.room;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  throw new Error('Canvas steward requires a room parameter');
}

function extractMessage(payload: JsonObject): string {
  const raw = payload.message || payload.instruction || payload.text;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  throw new Error('Canvas steward requires a message parameter');
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
