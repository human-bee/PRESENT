import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { join } from 'path';
import { RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import type { JsonObject } from '@/lib/utils/json-schema';
import {
  createDefaultScorecardState,
  debateScorecardStateSchema,
  recomputePlayerScoresFromClaims,
  type DebateScorecardState,
} from '@/lib/agents/debate-scorecard-schema';

// Ensure .env.local is loaded when running stewards/conductor in Node
try {
  config({ path: join(process.cwd(), '.env.local') });
} catch { }

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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
  } catch { }
}

let cachedSupabase: SupabaseClient | null = null;

const getSupabase = () => {
  if (cachedSupabase) return cachedSupabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase credentials missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
  }

  cachedSupabase = createClient(url, serviceRoleKey || anonKey, {
    auth: { persistSession: false },
  });
  return cachedSupabase;
};

let bypassLogged = false;
const logBypass = (scope: string) => {
  if (bypassLogged || !shouldBypassSupabase) return;
  bypassLogged = true;
  try {
    console.info(`ℹ️ [StewardSupabase] Dev bypass active (${scope}); using in-memory store only.`);
  } catch { }
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

export type CanvasComponentSnapshot = {
  componentId: string;
  componentType: string;
  props: JsonObject;
  state?: JsonObject | null;
  intentId?: string | null;
  lastUpdated?: number | null;
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

export type ScorecardRecord = {
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

type PromptCacheRecord = {
  signature: string;
  docVersion: number | string;
  parts: Record<string, unknown>;
  cachedAt: number;
};

const PROMPT_CACHE_STORE_KEY = '__present_canvas_prompt_cache__';
const promptCacheStore: Map<string, PromptCacheRecord> =
  (GLOBAL_APEX[PROMPT_CACHE_STORE_KEY] as Map<string, PromptCacheRecord> | undefined) ||
  new Map<string, PromptCacheRecord>();

type TranscriptRecord = {
  transcript: Array<{
    participantId: string;
    participantName?: string | null;
    text: string;
    timestamp: number;
    manual?: boolean;
  }>;
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

if (!GLOBAL_APEX[PROMPT_CACHE_STORE_KEY]) {
  GLOBAL_APEX[PROMPT_CACHE_STORE_KEY] = promptCacheStore;
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
const LIVEKIT_SEND_RETRY_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.LIVEKIT_SEND_RETRY_ATTEMPTS ?? '3', 10) || 3,
);
const LIVEKIT_SEND_RETRY_DELAY_MS = Math.max(
  0,
  Number.parseInt(process.env.LIVEKIT_SEND_RETRY_DELAY_MS ?? '200', 10) || 200,
);

let cachedRoomServiceClient: RoomServiceClient | null = null;
let cachedLivekitRestUrl: string | null = null;

const resolveLivekitRestUrl = () => {
  const raw =
    process.env.LIVEKIT_REST_URL ||
    process.env.LIVEKIT_URL ||
    process.env.NEXT_PUBLIC_LK_SERVER_URL ||
    process.env.NEXT_PUBLIC_LIVEKIT_URL ||
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
  const restUrl = resolveLivekitRestUrl();
  if (cachedRoomServiceClient && cachedLivekitRestUrl === restUrl) return cachedRoomServiceClient;

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('LiveKit API key/secret missing for REST broadcast');
  }

  cachedLivekitRestUrl = restUrl;
  cachedRoomServiceClient = new RoomServiceClient(restUrl, apiKey, apiSecret);
  return cachedRoomServiceClient;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LivekitRoomResolution = {
  client: RoomServiceClient;
  normalizedRoom: string;
  roomReady: boolean;
  waitError?: string | null;
};

const isRoomAlreadyExistsError = (error: unknown): boolean => {
  const typed = error as { code?: unknown; status?: unknown; statusCode?: unknown } | null;
  const numericCode =
    typeof typed?.code === 'number'
      ? typed.code
      : typeof typed?.statusCode === 'number'
        ? typed.statusCode
        : typeof typed?.status === 'number'
          ? typed.status
          : null;
  if (numericCode === 6 || numericCode === 409) return true;
  const stringCode = typeof typed?.code === 'string' ? typed.code.trim().toLowerCase() : '';
  if (stringCode === 'already_exists' || stringCode === 'alreadyexists') return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error ?? '');
  const normalized = message.toLowerCase();
  return (
    normalized.includes('already exists') ||
    normalized.includes('room already exists') ||
    normalized.includes('alreadyexists') ||
    normalized.includes('code = alreadyexists')
  );
};

const ensureLivekitRoom = async (room: string): Promise<LivekitRoomResolution> => {
  const client = getRoomServiceClient();
  const normalized = normalizeRoomName(room);
  const deadline = Date.now() + LIVEKIT_ROOM_WAIT_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const rooms = await client.listRooms([normalized]);
      if (rooms?.some((entry) => entry?.name === normalized)) {
        return { client, normalizedRoom: normalized, roomReady: true, waitError: null };
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(LIVEKIT_ROOM_WAIT_INTERVAL_MS);
  }

  try {
    await client.createRoom({
      name: normalized,
      emptyTimeout: 60,
      departureTimeout: 30,
    });
    return { client, normalizedRoom: normalized, roomReady: true, waitError: null };
  } catch (error) {
    if (isRoomAlreadyExistsError(error)) {
      return { client, normalizedRoom: normalized, roomReady: true, waitError: null };
    }
    lastError = error ?? lastError;
  }

  const context = {
    room: normalized,
    rest: cachedLivekitRestUrl,
    error: lastError instanceof Error ? lastError.message : lastError,
  };

  try {
    console.error('[LiveKit] Room not found before timeout', context);
  } catch { }

  return {
    client,
    normalizedRoom: normalized,
    roomReady: false,
    waitError:
      lastError instanceof Error
        ? `${lastError.message}${cachedLivekitRestUrl ? ` (rest=${cachedLivekitRestUrl})` : ''}`
        : String(lastError ?? ''),
  };
};

const sendLivekitData = async (params: {
  room: string;
  topic: string;
  data: Uint8Array;
}) => {
  const { room, topic, data } = params;
  let resolution = await ensureLivekitRoom(room);
  let lastError: unknown =
    resolution.roomReady
      ? null
      : new Error(
          resolution.waitError && resolution.waitError.trim().length > 0
            ? `LiveKit room readiness failed for ${resolution.normalizedRoom}: ${resolution.waitError}`
            : `LiveKit room not found before timeout: ${resolution.normalizedRoom}`,
        );

  for (let attempt = 0; attempt < LIVEKIT_SEND_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await resolution.client.sendData(
        resolution.normalizedRoom,
        data,
        DataPacket_Kind.RELIABLE,
        { topic },
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= LIVEKIT_SEND_RETRY_ATTEMPTS) {
        break;
      }
      if (LIVEKIT_SEND_RETRY_DELAY_MS > 0) {
        await sleep(LIVEKIT_SEND_RETRY_DELAY_MS);
      }
      resolution = await ensureLivekitRoom(room);
    }
  }

  throw new Error(
    `LiveKit sendData failed for ${resolution.normalizedRoom}: ${
      lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown')
    }`,
  );
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

const DEFAULT_PROMPT_CACHE_TTL_MS = Number(process.env.CANVAS_AGENT_PROMPT_CACHE_TTL_MS ?? 120_000);

export const readPromptCache = (room: string, signature: string, ttlMs = DEFAULT_PROMPT_CACHE_TTL_MS) => {
  const cached = promptCacheStore.get(canvasStateKey(room));
  if (!cached) return null;
  if (cached.signature !== signature) return null;
  if (Date.now() - cached.cachedAt > ttlMs) {
    promptCacheStore.delete(canvasStateKey(room));
    return null;
  }
  return cached;
};

export const writePromptCache = (
  room: string,
  record: { signature: string; docVersion: number | string; parts: Record<string, unknown> },
) => {
  promptCacheStore.set(canvasStateKey(room), { ...record, cachedAt: Date.now() });
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
  const versionSource =
    (base && typeof base === 'object' && typeof (base as Record<string, unknown>).version === 'number'
      ? (base as Record<string, unknown>).version
      : typeof entry.version === 'number'
        ? entry.version
        : fallback.version);
  const version = typeof versionSource === 'number' && Number.isFinite(versionSource) ? versionSource : 0;

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
  } catch { }
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
  if (!clone || typeof clone !== 'object') return null;
  const normalizedState = Array.isArray(clone)
    ? (clone as Array<unknown>)
    : (clone as Record<string, unknown>);
  try {
    const json = JSON.stringify(clone);
    const bytes = json.length;
    if (bytes <= limitBytes) {
      return { state: normalizedState, bytes, truncated: false };
    }

    const keys = Array.isArray(clone)
      ? Array.from({ length: Math.min(clone.length, 12) }, (_, idx) => idx)
      : Object.keys(normalizedState as Record<string, unknown>).slice(0, 12);
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
  entry: TranscriptRecord['transcript'][number],
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
    const canvasQuery = getSupabase().from('canvases').select('document, id');
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
      const { data: canvas, error: fetchErr } = await getSupabase()
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

      const { error: updateErr } = await getSupabase()
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

export async function getDebateScorecard(room: string, componentId: string): Promise<ScorecardRecord> {
  const fallback = readScorecardFallback(room, componentId);
  if (shouldBypassSupabase) {
    logBypass('getDebateScorecard');
    return fallback;
  }

  try {
    const lookup = deriveCanvasLookup(room);
    const canvasQuery = getSupabase().from('canvases').select('document, id');
    if (lookup.canvasId && isUuid(lookup.canvasId)) {
      canvasQuery.eq('id', lookup.canvasId);
    } else {
      canvasQuery.ilike('name', `%${lookup.fallback}%`);
    }
    const { data, error } = await canvasQuery.limit(1).maybeSingle();

    if (error) throw error;
    if (!data || typeof data.document !== 'object' || data.document === null) {
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
): Promise<ScorecardRecord> {
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

  const normalized = recomputePlayerScoresFromClaims(parsed);
  const nextVersion = normalized.version;
  const sanitizedState = JSON.parse(JSON.stringify(normalized)) as DebateScorecardState;

  if (shouldBypassSupabase) {
    logBypass('commitDebateScorecard');
  } else {
    try {
      const lookup = deriveCanvasLookup(room);
      const canvasQuery = getSupabase().from('canvases').select('id, document');
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

      const { error: updateErr } = await getSupabase()
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
    const canvasQuery = getSupabase().from('canvases').select('document, id');
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

    const store = (data.document?.store ||
      // Some saves persist the full TLDraw snapshot under `document.document`
      data.document?.document?.store ||
      {}) as Record<string, any>;
    if (process.env.NODE_ENV !== 'production') {
      try {
        const storeKeys = Object.keys(store);
        if (storeKeys.length === 0) {
          console.log('[StewardSupabase] listCanvasComponents store empty store payload', {
            room,
          });
        }
      } catch { }
    }
    const shapes: CanvasShapeSummary[] = [];

    const pushShape = (entry: any) => {
      if (!entry || typeof entry !== 'object') return;
      const normalized = normalizeShapeSummary(entry as Record<string, any>);
      if (normalized) shapes.push(normalized);
    };

    const rawShapeCollection = store.shape || store.shapes;
    if (Array.isArray(rawShapeCollection)) {
      rawShapeCollection.forEach(pushShape);
    } else if (rawShapeCollection && typeof rawShapeCollection === 'object') {
      Object.values(rawShapeCollection as Record<string, any>).forEach(pushShape);
    }

    Object.keys(store)
      .filter((key) => key.startsWith('shape:'))
      .forEach((key) => pushShape(store[key]));

    // Also handle top-level TLDraw snapshots stored as an array of records
    // (parity harness currently writes `{ shapes: [...], document: {...} }`).
    if (Array.isArray((data as any).shapes)) {
      (data as any).shapes.forEach(pushShape);
    }

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

export async function listCanvasComponents(room: string): Promise<CanvasComponentSnapshot[]> {
  if (!room) return [];

  if (shouldBypassSupabase) {
    logBypass('listCanvasComponents');
    return [];
  }

  try {
    const lookup = deriveCanvasLookup(room);
    const canvasQuery = getSupabase().from('canvases').select('document, id');
    if (lookup.canvasId && isUuid(lookup.canvasId)) {
      canvasQuery.eq('id', lookup.canvasId);
    } else {
      canvasQuery.ilike('name', `%${lookup.fallback}%`);
    }
    const { data, error } = await canvasQuery.limit(1).maybeSingle();

    if (error) throw error;
    if (!data || typeof data.document !== 'object' || data.document === null) {
      return [];
    }
    const document = data.document as {
      components?: Record<string, Record<string, unknown>>;
      store?: Record<string, any>;
      schemaVersion?: number;
    };
    const snapshots: CanvasComponentSnapshot[] = [];
    const seen = new Set<string>();

    const pushSnapshot = (entry: CanvasComponentSnapshot) => {
      if (!entry.componentId || seen.has(entry.componentId)) return;
      seen.add(entry.componentId);
      snapshots.push(entry);
    };

    const components = (document.components || {}) as Record<string, Record<string, unknown>>;

    for (const [componentId, entry] of Object.entries(components)) {
      if (!entry || typeof entry !== 'object') continue;
      const props =
        entry.props && typeof entry.props === 'object'
          ? (entry.props as JsonObject)
          : (entry as JsonObject);
      const stateCandidate = (() => {
        if (entry.state && typeof entry.state === 'object' && !Array.isArray(entry.state)) {
          return entry.state as JsonObject;
        }
        const scorecard = (entry as { scorecard?: { state?: JsonObject } }).scorecard;
        if (scorecard?.state && typeof scorecard.state === 'object') {
          return scorecard.state;
        }
        return undefined;
      })();

      const componentType = (() => {
        if (typeof (entry as { componentType?: unknown }).componentType === 'string') {
          return (entry as { componentType: string }).componentType;
        }
        if (typeof (entry as { type?: unknown }).type === 'string') {
          return (entry as { type: string }).type;
        }
        if (typeof props?.type === 'string') {
          return props.type as string;
        }
        if (stateCandidate && typeof stateCandidate.type === 'string') {
          return stateCandidate.type as string;
        }
        return 'unknown';
      })();

      const intentId = (() => {
        if (typeof (entry as { intentId?: unknown }).intentId === 'string') {
          return (entry as { intentId: string }).intentId;
        }
        if (typeof props?.intentId === 'string') {
          return props.intentId as string;
        }
        return undefined;
      })();

      pushSnapshot({
        componentId,
        componentType,
        props,
        state: stateCandidate ?? null,
        intentId: intentId ?? null,
        lastUpdated:
          typeof (entry as { lastUpdated?: unknown }).lastUpdated === 'number'
            ? ((entry as { lastUpdated: number }).lastUpdated as number)
            : typeof (entry as { updated_at?: unknown }).updated_at === 'number'
              ? ((entry as { updated_at: number }).updated_at as number)
              : null,
      });
    }

    const store = (document.store || {}) as Record<string, any>;
    const considerShapeEntry = (raw: any) => {
      if (!raw || typeof raw !== 'object') return;
      const props = raw.props && typeof raw.props === 'object' ? (raw.props as Record<string, any>) : null;
      if (!props) return;
      const componentId = typeof props.customComponent === 'string' ? props.customComponent : null;
      if (!componentId || seen.has(componentId)) return;
      const stateCandidate =
        props.state && typeof props.state === 'object' && !Array.isArray(props.state)
          ? (props.state as JsonObject)
          : undefined;
      const componentType = (() => {
        if (typeof props.name === 'string' && props.name.trim()) return props.name.trim();
        if (stateCandidate && typeof stateCandidate.type === 'string') return (stateCandidate.type as string).trim();
        if (typeof props.type === 'string') return props.type.trim();
        return 'unknown';
      })();
      pushSnapshot({
        componentId,
        componentType,
        props: stateCandidate ?? (props as JsonObject),
        state: stateCandidate ?? null,
        intentId: typeof props.intentId === 'string' ? props.intentId : null,
        lastUpdated:
          typeof props.updatedAt === 'number'
            ? (props.updatedAt as number)
            : typeof props.lastUpdated === 'number'
              ? (props.lastUpdated as number)
              : null,
      });
    };

    const rawShapeCollection = store.shape || store.shapes;
    if (Array.isArray(rawShapeCollection)) {
      rawShapeCollection.forEach(considerShapeEntry);
    } else if (rawShapeCollection && typeof rawShapeCollection === 'object') {
      Object.values(rawShapeCollection as Record<string, any>).forEach(considerShapeEntry);
    }
    Object.keys(store)
      .filter((key) => key.startsWith('shape:'))
      .forEach((key) => considerShapeEntry(store[key]));

    return snapshots;
  } catch (error) {
    warnFallback('listCanvasComponents', error);
    return [];
  }
}

export async function broadcastCanvasAction(event: {
  room: string;
  tool: string;
  params?: JsonObject;
}) {
  const { room, tool, params } = event;
  const action = { tool, params, timestamp: Date.now() };

  const data = new TextEncoder().encode(
    JSON.stringify({ type: 'tool_call', payload: action, source: 'canvas-steward', timestamp: Date.now() }),
  );
  await sendLivekitData({ room, data, topic: 'tool_call' });
}

export async function broadcastToolCall(event: {
  room: string;
  tool: string;
  params?: JsonObject;
  source?: string;
}) {
  const { room, tool, params, source = 'conductor' } = event;
  const action = { tool, params, timestamp: Date.now() };

  const data = new TextEncoder().encode(
    JSON.stringify({ type: 'tool_call', payload: action, source, timestamp: Date.now() }),
  );
  await sendLivekitData({ room, data, topic: 'tool_call' });
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

  await sendLivekitData({ room: trimmedRoom, data, topic: 'agent_prompt' });
}

export async function broadcastTranscription(event: {
  room: string;
  text: string;
  speaker?: string;
  manual?: boolean;
  timestamp?: number;
}) {
  const { room, text, speaker, manual = true, timestamp } = event;
  const trimmedRoom = normalizeRoomName(room);
  if (!trimmedRoom) {
    throw new Error('Room is required for transcription broadcast');
  }
  const cleanedText = String(text || '').trim();
  if (!cleanedText) {
    throw new Error('Transcription requires text');
  }
  const payload = {
    text: cleanedText,
    speaker: typeof speaker === 'string' && speaker.trim().length > 0 ? speaker.trim() : undefined,
    manual: Boolean(manual),
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
  };
  const data = new TextEncoder().encode(JSON.stringify(payload));
  await sendLivekitData({ room: trimmedRoom, data, topic: 'transcription' });
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
    const cutoff = Date.now() - Math.max(1_000, windowMs);
    const { data, error } = await getSupabase()
      .from('canvas_session_transcripts')
      .select('participant_id, participant_name, text, ts, manual')
      .eq('room_name', room)
      .gte('ts', cutoff)
      .order('ts', { ascending: true })
      .limit(240);

    if (error) throw new Error(error.message);

    const transcript = (data || [])
      .map((row: any) => ({
        participantId: String(row?.participant_id ?? 'unknown'),
        participantName:
          typeof row?.participant_name === 'string' && row.participant_name.trim().length > 0
            ? row.participant_name.trim()
            : undefined,
        text: String(row?.text ?? ''),
        timestamp: typeof row?.ts === 'number' ? row.ts : Date.now(),
        manual: typeof row?.manual === 'boolean' ? row.manual : undefined,
      }))
      .filter((line) => typeof line.text === 'string' && line.text.trim().length > 0);

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

// =============================================================================
// Context Documents (user-uploaded markdown/text for steward context)
// =============================================================================

export type ContextDocument = {
  id: string;
  title: string;
  content: string;
  type: 'markdown' | 'text';
  timestamp: number;
  source: 'file' | 'paste';
};

/**
 * Retrieves user-uploaded context documents for a room/session.
 * These documents are injected into steward prompts alongside the transcript.
 */
export async function getContextDocuments(room: string): Promise<ContextDocument[]> {
  if (shouldBypassSupabase) {
    logBypass('getContextDocuments');
    return [];
  }

  try {
    // Try to find session by room name
    const { data, error } = await getSupabase()
      .from('sessions')
      .select('context_documents')
      .eq('room_name', room)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!data?.context_documents) {
      return [];
    }

    const docs = Array.isArray(data.context_documents) ? data.context_documents : [];
    return docs as ContextDocument[];
  } catch (err) {
    warnFallback('getContextDocuments', err);
    return [];
  }
}

/**
 * Formats context documents into a string for inclusion in steward prompts.
 */
export function formatContextDocuments(docs: ContextDocument[]): string {
  if (docs.length === 0) return '';

  return docs
    .map((doc) => {
      const typeLabel = doc.type === 'markdown' ? 'Markdown' : 'Text';
      return `[${typeLabel}: ${doc.title}]\n${doc.content}`;
    })
    .join('\n\n---\n\n');
}
