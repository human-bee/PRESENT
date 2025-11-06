import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { join } from 'path';
import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import type { JsonObject } from '@/lib/utils/json-schema';
import {
  createDefaultScorecardState,
  debateScorecardStateSchema,
  type DebateScorecardState,
} from '@/lib/agents/debate-scorecard-schema';

// Ensure .env.local is loaded when running stewards/conductor in Node
try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!url || !anonKey) {
  throw new Error('Supabase credentials missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

const supabaseKey = serviceRoleKey || anonKey;

const hasServiceRoleKey = Boolean(serviceRoleKey);
const bypassFlag = process.env.STEWARDS_SUPABASE_BYPASS;
const shouldBypassSupabase =
  bypassFlag === '1' ||
  (!hasServiceRoleKey && bypassFlag !== '0' && process.env.NODE_ENV !== 'production');

if (!serviceRoleKey && process.env.NODE_ENV === 'development' && !shouldBypassSupabase) {
  try {
    console.warn(
      '⚠️ [StewardSupabase] Using anon key for Supabase access. Provide SUPABASE_SERVICE_ROLE_KEY for full access.',
    );
  } catch {}
}

const supabase = createClient(url, supabaseKey, {
  auth: { persistSession: false },
});

let bypassLogged = false;
const logBypass = (scope: string) => {
  if (bypassLogged || !shouldBypassSupabase) return;
  bypassLogged = true;
  try {
    console.info(`ℹ️ [StewardSupabase] Dev bypass active (${scope}); using in-memory store only.`);
  } catch {}
};

type FlowchartDocRecord = {
  doc: string;
  format: 'streamdown' | 'markdown' | 'mermaid';
  version: number;
  rationale?: string;
};

export type CanvasShapeSummary = {
  id: string;
  type: string;
  name?: string;
  label?: string;
  text?: string;
  parentId?: string;
  meta?: Record<string, unknown>;
  state?: Record<string, unknown> | Array<unknown>;
  stateBytes?: number;
  stateTruncated?: boolean;
};

type CanvasStateRecord = {
  version: number;
  shapes: CanvasShapeSummary[];
  lastUpdated: number;
};

export type CanvasAgentPromptBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CanvasAgentPromptPayload = {
  message: string;
  requestId: string;
  bounds?: CanvasAgentPromptBounds;
  selectionIds?: string[];
  metadata?: JsonObject | null;
};

const GLOBAL_APEX = globalThis as Record<string, unknown>;
const MEMORY_STORE_KEY = '__present_flowchart_memory_store__';
const memoryStore: Map<string, FlowchartDocRecord> =
  (GLOBAL_APEX[MEMORY_STORE_KEY] as Map<string, FlowchartDocRecord> | undefined) ||
  new Map<string, FlowchartDocRecord>();

type ScorecardRecord = {
  state: DebateScorecardState;
  version: number;
  lastUpdated: number;
};

const SCORECARD_MEMORY_KEY = '__present_debate_scorecard_store__';
const scorecardStore: Map<string, ScorecardRecord> =
  (GLOBAL_APEX[SCORECARD_MEMORY_KEY] as Map<string, ScorecardRecord> | undefined) ||
  new Map<string, ScorecardRecord>();

const CANVAS_STATE_STORE_KEY = '__present_canvas_state_store__';
const canvasStateStore: Map<string, CanvasStateRecord> =
  (GLOBAL_APEX[CANVAS_STATE_STORE_KEY] as Map<string, CanvasStateRecord> | undefined) ||
  new Map<string, CanvasStateRecord>();

type TranscriptRecord = {
  transcript: Array<{ participantId: string; text: string; timestamp: number }>;
  cachedAt: number;
};

const TRANSCRIPT_STORE_KEY = '__present_flowchart_transcript_store__';
const transcriptStore: Map<string, TranscriptRecord> =
  (GLOBAL_APEX[TRANSCRIPT_STORE_KEY] as Map<string, TranscriptRecord> | undefined) ||
  new Map<string, TranscriptRecord>();

if (!GLOBAL_APEX[MEMORY_STORE_KEY]) {
  GLOBAL_APEX[MEMORY_STORE_KEY] = memoryStore;
}

if (!GLOBAL_APEX[SCORECARD_MEMORY_KEY]) {
  GLOBAL_APEX[SCORECARD_MEMORY_KEY] = scorecardStore;
}

if (!GLOBAL_APEX[TRANSCRIPT_STORE_KEY]) {
  GLOBAL_APEX[TRANSCRIPT_STORE_KEY] = transcriptStore;
}

if (!GLOBAL_APEX[CANVAS_STATE_STORE_KEY]) {
  GLOBAL_APEX[CANVAS_STATE_STORE_KEY] = canvasStateStore;
}

export function normalizeRoomName(name: string) {
  return name.trim();
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID_V4_REGEX.test(value);

const deriveCanvasLookup = (room: string) => {
  const normalized = normalizeRoomName(room);
  const match = normalized.match(/^canvas-([a-zA-Z0-9_-]+)$/);
  if (match?.[1]) {
    return { canvasId: match[1], fallback: normalized } as const;
  }
  return { canvasId: null, fallback: normalized } as const;
};

const LIVEKIT_ROOM_WAIT_TIMEOUT_MS = Number(process.env.LIVEKIT_ROOM_WAIT_TIMEOUT_MS ?? 5000);
const LIVEKIT_ROOM_WAIT_INTERVAL_MS = Number(process.env.LIVEKIT_ROOM_WAIT_INTERVAL_MS ?? 250);

let cachedRoomServiceClient: RoomServiceClient | null = null;
let cachedLivekitRestUrl: string | null = null;

const resolveLivekitRestUrl = () => {
  const raw =
    process.env.LIVEKIT_REST_URL ||
    process.env.LIVEKIT_URL ||
    process.env.NEXT_PUBLIC_LK_SERVER_URL ||
    process.env.LIVEKIT_HOST;

  if (!raw) {
    throw new Error('LiveKit server credentials missing for REST broadcast');
  }

  let url = raw.trim();
  if (url.startsWith('wss://')) {
    url = `https://${url.slice(6)}`;
  } else if (url.startsWith('ws://')) {
    url = `http://${url.slice(5)}`;
  } else if (!/^https?:\/\//i.test(url)) {
    url = `https://${url.replace(/^\/+/, '')}`;
  }

  return url.replace(/\/+$/, '');
};

const getRoomServiceClient = () => {
  if (cachedRoomServiceClient) {
    return cachedRoomServiceClient;
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit API key/secret missing for REST broadcast');
  }

  const restUrl = resolveLivekitRestUrl();
  cachedLivekitRestUrl = restUrl;
  cachedRoomServiceClient = new RoomServiceClient(restUrl, apiKey, apiSecret);
  return cachedRoomServiceClient;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureLivekitRoom = async (room: string) => {
  const client = getRoomServiceClient();
  const normalized = normalizeRoomName(room);
  const deadline = Date.now() + LIVEKIT_ROOM_WAIT_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const rooms = await client.listRooms([normalized]);
      if (rooms?.some((entry) => entry?.name === normalized)) {
        return { client, normalizedRoom: normalized };
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(LIVEKIT_ROOM_WAIT_INTERVAL_MS);
  }

  const context = {
    room: normalized,
    rest: cachedLivekitRestUrl,
    error: lastError instanceof Error ? lastError.message : lastError,
  };

  try {
    console.error('[LiveKit] Room not found before timeout', context);
  } catch {}
  throw new Error(`LiveKit room not found before timeout: ${normalized}`);
};

const fallbackKey = (room: string, docId: string) => `${room}::${docId}`;
const canvasStateKey = (room: string) => `${room}`;
const scorecardMemoryKey = (room: string, componentId: string) => `${room}::${componentId}`;

const readFallback = (room: string, docId: string): FlowchartDocRecord => {
  return (memoryStore.get(fallbackKey(room, docId)) ?? {
    doc: '',
    format: 'mermaid',
    version: 0,
  }) as FlowchartDocRecord;
};

const writeFallback = (room: string, docId: string, record: FlowchartDocRecord) => {
  memoryStore.set(fallbackKey(room, docId), record);
};

const readScorecardFallback = (room: string, componentId: string): ScorecardRecord => {
  const key = scorecardMemoryKey(room, componentId);
  const existing = scorecardStore.get(key);
  if (existing) return existing;
  const state = createDefaultScorecardState();
  state.componentId = componentId;
  const record: ScorecardRecord = { state, version: 0, lastUpdated: Date.now() };
  scorecardStore.set(key, record);
  return record;
};

const writeScorecardFallback = (room: string, componentId: string, record: ScorecardRecord) => {
  scorecardStore.set(scorecardMemoryKey(room, componentId), {
    ...record,
    lastUpdated: Date.now(),
  });
};

const defaultCanvasState = (room: string): CanvasStateRecord => {
  const cached = canvasStateStore.get(canvasStateKey(room));
  if (cached) return cached;
  const empty: CanvasStateRecord = { version: 0, shapes: [], lastUpdated: Date.now() };
  canvasStateStore.set(canvasStateKey(room), empty);
  return empty;
};

const writeCanvasState = (room: string, record: CanvasStateRecord) => {
  canvasStateStore.set(canvasStateKey(room), { ...record, lastUpdated: Date.now() });
};

const normalizeRecord = (room: string, docId: string, entry: Record<string, unknown>) => {
  const fallback = readFallback(room, docId);
  const doc = typeof entry.flowchartDoc === 'string' ? entry.flowchartDoc : fallback.doc;
  const format = ['streamdown', 'markdown', 'mermaid'].includes(String(entry.format))
    ? (entry.format as FlowchartDocRecord['format'])
    : fallback.format;
  const version = typeof entry.version === 'number' ? entry.version : fallback.version;
  const next: FlowchartDocRecord = {
    doc,
    format,
    version,
    rationale: typeof entry.rationale === 'string' ? entry.rationale : fallback.rationale,
  };
  writeFallback(room, docId, next);
  return next;
};

const normalizeScorecardRecord = (room: string, componentId: string, entry: Record<string, unknown>) => {
  const fallback = readScorecardFallback(room, componentId);
  const base = entry?.scorecard && typeof entry.scorecard === 'object' ? (entry.scorecard as Record<string, unknown>) : entry;
  const stateInput =
    base && typeof base === 'object' && 'state' in base && typeof (base as Record<string, unknown>).state === 'object'
      ? (base as Record<string, unknown>).state
      : base;

  const parsed = debateScorecardStateSchema.safeParse(
    stateInput && typeof stateInput === 'object'
      ? { ...(stateInput as JsonObject), componentId }
      : { ...fallback.state, componentId },
  );

  const state = parsed.success ? parsed.data : fallback.state;
  const version =
    (base && typeof base === 'object' && typeof (base as Record<string, unknown>).version === 'number'
      ? (base as Record<string, unknown>).version
      : typeof entry.version === 'number'
        ? entry.version
        : fallback.version) ?? 0;

  const normalized: ScorecardRecord = {
    state: {
      ...state,
      componentId,
      version,
      lastUpdated: Date.now(),
    },
    version,
    lastUpdated: Date.now(),
  };

  writeScorecardFallback(room, componentId, normalized);
  return normalized;
};

const warnFallback = (scope: string, error: unknown) => {
  if (process.env.NODE_ENV !== 'development') return;
  const message = error instanceof Error ? error.message : String(error);
  try {
    console.warn(`⚠️ [StewardSupabase] ${scope} fell back to in-memory store`, { message });
  } catch {}
};

const parseStateValue = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return null;
  try {
    // Deep-clone via JSON to discard funcs/undefined/cycles.
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

const parsedStateLimit = Number.parseInt(process.env.CANVAS_AGENT_SHAPE_STATE_LIMIT || '4096', 10);
const MAX_SHAPE_STATE_BYTES = Number.isFinite(parsedStateLimit) && parsedStateLimit > 0 ? parsedStateLimit : 4096;

const sanitizeShapeState = (
  raw: unknown,
  limitBytes: number,
): { state: Record<string, unknown> | Array<unknown>; bytes: number; truncated: boolean } | null => {
  const clone = parseStateValue(raw);
  if (!clone) return null;
  try {
    const json = JSON.stringify(clone);
    const bytes = json.length;
    if (bytes <= limitBytes) {
      return { state: clone, bytes, truncated: false };
    }

    const keys = Array.isArray(clone)
      ? Array.from({ length: Math.min(clone.length, 12) }, (_, idx) => idx)
      : Object.keys(clone as Record<string, unknown>).slice(0, 12);
    const preview = json.slice(0, Math.max(0, limitBytes));
    return {
      state: {
        __truncated: true,
        preview,
        keys,
        originalBytes: bytes,
      } as Record<string, unknown>,
      bytes,
      truncated: true,
    };
  } catch {
    return null;
  }
};

const normalizeShapeSummary = (shapeEntry: Record<string, any>): CanvasShapeSummary | null => {
  const id = typeof shapeEntry.id === 'string' ? shapeEntry.id : undefined;
  const type = typeof shapeEntry.type === 'string' ? shapeEntry.type : undefined;
  if (!id || !type) return null;
  const summary: CanvasShapeSummary = { id, type };
  const meta: Record<string, unknown> = {};
  if (typeof shapeEntry.x === 'number') meta.x = shapeEntry.x;
  if (typeof shapeEntry.y === 'number') meta.y = shapeEntry.y;
  if (typeof shapeEntry.w === 'number') meta.width = shapeEntry.w;
  if (typeof shapeEntry.h === 'number') meta.height = shapeEntry.h;
  if (typeof shapeEntry.name === 'string') summary.name = shapeEntry.name;
  if (typeof shapeEntry.label === 'string') summary.label = shapeEntry.label;
  if (typeof shapeEntry.text === 'string') summary.text = shapeEntry.text;
  if (typeof shapeEntry.parentId === 'string') summary.parentId = shapeEntry.parentId;
  if (shapeEntry.props && typeof shapeEntry.props === 'object') {
    const props = shapeEntry.props as Record<string, unknown>;
    const candidateText = props.text ?? props.name ?? props.label ?? props.rawText;
    if (typeof candidateText === 'string') summary.text = candidateText;
    if (typeof props.geometricId === 'string') meta.geometricId = props.geometricId;
    if (typeof props.geo === 'string') meta.geo = props.geo;
    if (typeof props.w === 'number') meta.width = props.w;
    if (typeof props.h === 'number') meta.height = props.h;
    if (typeof props.color === 'string') meta.color = props.color;
    if (typeof props.fill === 'string') meta.fill = props.fill;
    if (typeof props.label === 'string' && !summary.label) summary.label = props.label;
    if (typeof props.parentId === 'string' && !summary.parentId) summary.parentId = props.parentId;
    if (props.state && typeof MAX_SHAPE_STATE_BYTES === 'number' && Number.isFinite(MAX_SHAPE_STATE_BYTES)) {
      const sanitized = sanitizeShapeState(props.state, Math.max(512, MAX_SHAPE_STATE_BYTES));
      if (sanitized) {
        summary.state = sanitized.state;
        summary.stateBytes = sanitized.bytes;
        summary.stateTruncated = sanitized.truncated;
      }
    }
  }
  if (Object.keys(meta).length > 0) summary.meta = meta;
  return summary;
};

const setTranscriptCache = (room: string, transcript: TranscriptRecord['transcript']) => {
  transcriptStore.set(room, { transcript, cachedAt: Date.now() });
};

export const appendTranscriptCache = (
  room: string,
  entry: { participantId: string; text: string; timestamp: number },
) => {
  const existing = transcriptStore.get(room);
  if (existing) {
    existing.transcript.push(entry);
    existing.cachedAt = Date.now();
  } else {
    transcriptStore.set(room, { transcript: [entry], cachedAt: Date.now() });
  }
};

export async function getFlowchartDoc(room: string, docId: string) {
  const fallback = readFallback(room, docId);
  if (shouldBypassSupabase) {
    logBypass('getFlowchartDoc');
    return fallback;
  }
  try {
    const lookup = deriveCanvasLookup(room);
    const canvasQuery = supabase.from('canvases').select('document, id');
    if (lookup.canvasId && isUuid(lookup.canvasId)) {
      canvasQuery.eq('id', lookup.canvasId);
    } else {
      canvasQuery.ilike('name', `%${lookup.fallback}%`);
    }
    const { data, error } = await canvasQuery.limit(1).maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return fallback;
    }

    const components = (data.document?.components || {}) as Record<string, Record<string, unknown>>;
    const entry = components[docId];
    if (!entry) {
      return fallback;
    }

    return normalizeRecord(room, docId, entry);
  } catch (err) {
    warnFallback('get', err);
    return fallback;
  }
}

export async function commitFlowchartDoc(
  room: string,
  docId: string,
  payload: { format: 'streamdown' | 'markdown' | 'mermaid'; doc: string; prevVersion?: number; rationale?: string },
) {
  const current = await getFlowchartDoc(room, docId);
  if (typeof payload.prevVersion === 'number' && payload.prevVersion !== current.version) {
    throw new Error('CONFLICT');
  }

  const nextVersion = (current.version || 0) + 1;
  const nextRecord: FlowchartDocRecord = {
    doc: payload.doc,
    format: payload.format,
    version: nextVersion,
    rationale: payload.rationale,
  };

  if (shouldBypassSupabase) {
    logBypass('commitFlowchartDoc');
  } else {
    try {
      const { data: canvas, error: fetchErr } = await supabase
        .from('canvases')
        .select('id, document')
        .ilike('name', `%${room}%`)
        .limit(1)
        .maybeSingle();

      if (fetchErr || !canvas) {
        throw fetchErr || new Error('NOT_FOUND');
      }

      const document = canvas.document || {};
      document.components = document.components || {};
      document.components[docId] = {
        ...(document.components[docId] || {}),
        flowchartDoc: payload.doc,
        format: payload.format,
        version: nextVersion,
        rationale: payload.rationale,
        updated_at: Date.now(),
      };

      const { error: updateErr } = await supabase
        .from('canvases')
        .update({ document })
        .eq('id', canvas.id);

      if (updateErr) {
        throw updateErr;
      }
    } catch (err) {
      warnFallback('commit', err);
    }
  }

  writeFallback(room, docId, nextRecord);

  return { version: nextVersion };
}

export async function getDebateScorecard(room: string, componentId: string) {
  const fallback = readScorecardFallback(room, componentId);
  if (shouldBypassSupabase) {
    logBypass('getDebateScorecard');
    return fallback;
  }

  try {
    const lookup = deriveCanvasLookup(room);
    const canvasQuery = supabase.from('canvases').select('document, id');
    if (lookup.canvasId && isUuid(lookup.canvasId)) {
      canvasQuery.eq('id', lookup.canvasId);
    } else {
      canvasQuery.ilike('name', `%${lookup.fallback}%`);
    }
    const { data, error } = await canvasQuery.limit(1).maybeSingle();

    if (error) throw error;
    if (!data || !data.document) {
      return fallback;
    }

    const components = (data.document?.components || {}) as Record<string, Record<string, unknown>>;
    const entry = components[componentId];
    if (!entry) {
      return fallback;
    }
    return normalizeScorecardRecord(room, componentId, entry);
  } catch (error) {
    warnFallback('getDebateScorecard', error);
    return fallback;
  }
}

export async function commitDebateScorecard(
  room: string,
  componentId: string,
  payload: { state: DebateScorecardState; prevVersion?: number },
) {
  const current = await getDebateScorecard(room, componentId);
  if (typeof payload.prevVersion === 'number' && payload.prevVersion !== current.version) {
    throw new Error('CONFLICT');
  }

  const parsed = debateScorecardStateSchema.parse({
    ...payload.state,
    componentId,
    version: (current.version || 0) + 1,
    lastUpdated: Date.now(),
  });

  const nextVersion = parsed.version;
  const sanitizedState = JSON.parse(JSON.stringify(parsed)) as DebateScorecardState;

  if (shouldBypassSupabase) {
    logBypass('commitDebateScorecard');
  } else {
    try {
      const lookup = deriveCanvasLookup(room);
      const canvasQuery = supabase.from('canvases').select('id, document');
      if (lookup.canvasId && isUuid(lookup.canvasId)) {
        canvasQuery.eq('id', lookup.canvasId);
      } else {
        canvasQuery.ilike('name', `%${lookup.fallback}%`);
      }
      const { data: canvas, error: fetchErr } = await canvasQuery.limit(1).maybeSingle();

      if (fetchErr || !canvas) {
        throw fetchErr || new Error('NOT_FOUND');
      }

      const document = canvas.document || {};
      document.components = document.components || {};
      const componentEntry = document.components[componentId] || {};
      document.components[componentId] = {
        ...componentEntry,
        ...sanitizedState,
        scorecard: {
          state: sanitizedState,
          version: nextVersion,
          updated_at: Date.now(),
        },
        version: nextVersion,
        updated_at: Date.now(),
      };

      const { error: updateErr } = await supabase
        .from('canvases')
        .update({ document })
        .eq('id', canvas.id);

      if (updateErr) {
        throw updateErr;
      }
    } catch (error) {
      warnFallback('commitDebateScorecard', error);
    }
  }

  const record: ScorecardRecord = {
    state: sanitizedState,
    version: nextVersion,
    lastUpdated: Date.now(),
  };
  writeScorecardFallback(room, componentId, record);
  return record;
}

export async function getCanvasShapeSummary(room: string) {
  const cached = canvasStateStore.get(canvasStateKey(room));
  if (cached && Date.now() - cached.lastUpdated < 5_000) {
    return cached;
  }

  if (shouldBypassSupabase) {
    logBypass('getCanvasShapeSummary');
    return defaultCanvasState(room);
  }

  try {
    const lookup = deriveCanvasLookup(room);
    const canvasQuery = supabase.from('canvases').select('document, id');
    if (lookup.canvasId && isUuid(lookup.canvasId)) {
      canvasQuery.eq('id', lookup.canvasId);
    } else {
      canvasQuery.ilike('name', `%${lookup.fallback}%`);
    }
    const { data, error } = await canvasQuery.limit(1).maybeSingle();

    if (error) {
      throw error;
    }

    if (!data || !data.document) {
      return defaultCanvasState(room);
    }

    const store = (data.document?.store || {}) as Record<string, any>;
    const shapes: CanvasShapeSummary[] = [];

    const pushShape = (entry: any) => {
      if (!entry || typeof entry !== 'object') return;
      const normalized = normalizeShapeSummary(entry as Record<string, any>);
      if (normalized) shapes.push(normalized);
    };

    const rawShapeCollection = store['shape'] || store.shapes;
    if (Array.isArray(rawShapeCollection)) {
      rawShapeCollection.forEach(pushShape);
    } else if (rawShapeCollection && typeof rawShapeCollection === 'object') {
      Object.values(rawShapeCollection as Record<string, any>).forEach(pushShape);
    }

    Object.keys(store)
      .filter((key) => key.startsWith('shape:'))
      .forEach((key) => pushShape(store[key]));

    const record: CanvasStateRecord = {
      version: typeof data.document?.schemaVersion === 'number' ? data.document.schemaVersion : 0,
      shapes,
      lastUpdated: Date.now(),
    };
    writeCanvasState(room, record);
    return record;
  } catch (err) {
    warnFallback('getCanvasShapeSummary', err);
    return defaultCanvasState(room);
  }
}

export async function broadcastCanvasAction(event: {
  room: string;
  tool: string;
  params?: JsonObject;
}) {
  const { room, tool, params } = event;
  const action = { tool, params, timestamp: Date.now() };

  const { client, normalizedRoom } = await ensureLivekitRoom(room);
  const data = new TextEncoder().encode(
    JSON.stringify({ type: 'tool_call', payload: action, source: 'canvas-steward', timestamp: Date.now() }),
  );
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'tool_call' });
}

export async function broadcastToolCall(event: {
  room: string;
  tool: string;
  params?: JsonObject;
  source?: string;
}) {
  const { room, tool, params, source = 'conductor' } = event;
  const action = { tool, params, timestamp: Date.now() };

  const { client, normalizedRoom } = await ensureLivekitRoom(room);
  const data = new TextEncoder().encode(
    JSON.stringify({ type: 'tool_call', payload: action, source, timestamp: Date.now() }),
  );
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'tool_call' });
}

export async function broadcastAgentPrompt(event: {
  room: string;
  payload: CanvasAgentPromptPayload;
}) {
  const { room, payload } = event;
  const trimmedRoom = normalizeRoomName(room);
  if (!trimmedRoom) {
    throw new Error('Room is required for agent prompt broadcast');
  }

  const now = Date.now();
  const sanitizedPayload: CanvasAgentPromptPayload = {
    message: String(payload?.message ?? '').trim(),
    requestId: String(payload?.requestId ?? '').trim(),
    bounds: payload?.bounds,
    selectionIds: Array.isArray(payload?.selectionIds)
      ? payload.selectionIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : undefined,
    metadata: payload?.metadata ?? null,
  };

  if (!sanitizedPayload.message) {
    throw new Error('Agent prompt requires a message');
  }
  if (!sanitizedPayload.requestId) {
    throw new Error('Agent prompt requires a requestId');
  }

  const data = new TextEncoder().encode(
    JSON.stringify({
      type: 'agent_prompt',
      payload: sanitizedPayload,
      source: 'conductor',
      timestamp: now,
    }),
  );

  const { client, normalizedRoom } = await ensureLivekitRoom(trimmedRoom);
  await client.sendData(normalizedRoom, data, DataPacket_Kind.RELIABLE, { topic: 'agent_prompt' });
}

export async function getTranscriptWindow(room: string, windowMs: number) {
  const cache = transcriptStore.get(room);
  const useCache = cache && Date.now() - cache.cachedAt < 5_000;

  if (useCache) {
    const now = Date.now();
    const filtered = cache.transcript.filter((l) => now - (l.timestamp || 0) <= windowMs);
    return { transcript: filtered };
  }

  if (shouldBypassSupabase) {
    logBypass('getTranscriptWindow');
    if (cache) {
      const now = Date.now();
      const filtered = cache.transcript.filter((l) => now - (l.timestamp || 0) <= windowMs);
      return { transcript: filtered };
    }
    return { transcript: [] };
  }

  try {
    const { data, error } = await supabase
      .from('canvas_sessions')
      .select('transcript')
      .eq('room_name', room)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    const transcript = Array.isArray(data?.transcript) ? data.transcript : [];
    setTranscriptCache(room, transcript);
    const now = Date.now();
    const filtered = transcript.filter((l: any) => now - (l.timestamp || 0) <= windowMs);
    return { transcript: filtered };
  } catch (err) {
    warnFallback('transcript', err);
    if (cache) {
      const now = Date.now();
      const filtered = cache.transcript.filter((l) => now - (l.timestamp || 0) <= windowMs);
      return { transcript: filtered };
    }
    return { transcript: [] };
  }
}
