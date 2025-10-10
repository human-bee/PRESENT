import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { join } from 'path';

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

const shouldBypassSupabase =
  process.env.STEWARDS_SUPABASE_BYPASS === '1' ||
  (process.env.NODE_ENV !== 'production' && process.env.STEWARDS_SUPABASE_BYPASS !== '0');

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

const GLOBAL_APEX = globalThis as Record<string, unknown>;
const MEMORY_STORE_KEY = '__present_flowchart_memory_store__';
const memoryStore: Map<string, FlowchartDocRecord> =
  (GLOBAL_APEX[MEMORY_STORE_KEY] as Map<string, FlowchartDocRecord> | undefined) ||
  new Map<string, FlowchartDocRecord>();

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

if (!GLOBAL_APEX[TRANSCRIPT_STORE_KEY]) {
  GLOBAL_APEX[TRANSCRIPT_STORE_KEY] = transcriptStore;
}

type CanvasSnapshotRecord = {
  document: Record<string, unknown> | null;
  updatedAt: number | null;
};

const CANVAS_MEMORY_KEY = '__present_canvas_snapshot_store__';
const canvasSnapshotStore: Map<string, CanvasSnapshotRecord> =
  (GLOBAL_APEX[CANVAS_MEMORY_KEY] as Map<string, CanvasSnapshotRecord> | undefined) ||
  new Map<string, CanvasSnapshotRecord>();

if (!GLOBAL_APEX[CANVAS_MEMORY_KEY]) {
  GLOBAL_APEX[CANVAS_MEMORY_KEY] = canvasSnapshotStore;
}

const fallbackKey = (room: string, docId: string) => `${room}::${docId}`;

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

const readCanvasSnapshot = (room: string): CanvasSnapshotRecord => {
  return canvasSnapshotStore.get(room) ?? { document: null, updatedAt: null };
};

const writeCanvasSnapshot = (room: string, record: CanvasSnapshotRecord) => {
  canvasSnapshotStore.set(room, record);
};

const warnFallback = (scope: string, error: unknown) => {
  if (process.env.NODE_ENV !== 'development') return;
  const message = error instanceof Error ? error.message : String(error);
  try {
    console.warn(`⚠️ [StewardSupabase] ${scope} fell back to in-memory store`, { message });
  } catch {}
};

export type CanvasShapeSummary = {
  id: string;
  type: string;
  name?: string;
  text?: string;
  geo?: string;
  pageId?: string;
  childIndex?: number;
};

export interface CanvasSummary {
  shapes: CanvasShapeSummary[];
  totalShapes: number;
  pageCount: number;
  components: number;
  lastUpdated: number | string | null;
}

const coerceLimit = (limit?: number | null) => {
  if (typeof limit !== 'number' || Number.isNaN(limit)) return undefined;
  const clamped = Math.max(1, Math.min(200, Math.floor(limit)));
  return clamped;
};

const safeObjectKeys = (value: unknown) => {
  if (!value || typeof value !== 'object') return [] as string[];
  try {
    return Object.keys(value as Record<string, unknown>);
  } catch {
    return [] as string[];
  }
};

const extractFirstString = (entry: Record<string, unknown> | undefined, keys: string[]) => {
  if (!entry) return undefined;
  for (const key of keys) {
    const raw = entry[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return undefined;
};

export function summarizeCanvasDocument(
  document: unknown,
  options: { maxShapes?: number | null } = {},
): { shapes: CanvasShapeSummary[]; totalShapes: number; pageCount: number; components: number } {
  const limit = coerceLimit(options.maxShapes ?? undefined);
  const doc = (document && typeof document === 'object' ? (document as Record<string, unknown>) : {}) ?? {};
  const store = (doc.store && typeof doc.store === 'object' ? (doc.store as Record<string, unknown>) : {}) ?? {};

  const shapes: CanvasShapeSummary[] = [];
  let totalShapes = 0;

  for (const [key, rawValue] of Object.entries(store)) {
    if (!key.startsWith('shape:')) continue;
    if (!rawValue || typeof rawValue !== 'object') continue;
    totalShapes += 1;
    if (limit && shapes.length >= limit) {
      continue;
    }

    const value = rawValue as Record<string, unknown>;
    const shapeIdRaw = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : key.replace(/^shape:/, '');
    const type = extractFirstString(value, ['type']) ?? 'unknown';
    const props = value.props && typeof value.props === 'object' ? (value.props as Record<string, unknown>) : undefined;
    const meta = value.meta && typeof value.meta === 'object' ? (value.meta as Record<string, unknown>) : undefined;

    const summary: CanvasShapeSummary = {
      id: shapeIdRaw,
      type,
    };

    const parentId = extractFirstString(value, ['parentId', 'pageId']);
    if (parentId) {
      summary.pageId = parentId;
    }

    if (typeof value.childIndex === 'number' && Number.isFinite(value.childIndex)) {
      summary.childIndex = value.childIndex;
    }

    summary.name = extractFirstString(meta, ['name', 'title']) ?? extractFirstString(props, ['name']);

    const textCandidate =
      extractFirstString(props, ['text', 'label', 'richText']) || extractFirstString(meta, ['label', 'text']);
    if (textCandidate) {
      summary.text = textCandidate;
    }

    const geo = extractFirstString(props, ['geo', 'shape']);
    if (geo) {
      summary.geo = geo;
    }

    shapes.push(summary);
  }

  const pages = doc.pages && typeof doc.pages === 'object' ? (doc.pages as Record<string, unknown>) : undefined;
  const components =
    doc.components && typeof doc.components === 'object' ? (doc.components as Record<string, unknown>) : undefined;

  return {
    shapes,
    totalShapes,
    pageCount: pages ? safeObjectKeys(pages).length : 0,
    components: components ? safeObjectKeys(components).length : 0,
  };
}

export async function getCanvasSummary(
  room: string,
  options: { maxShapes?: number | null } = {},
): Promise<CanvasSummary> {
  const normalizedRoom = room.trim();
  const snapshot = readCanvasSnapshot(normalizedRoom);

  const fallbackSummary = {
    ...summarizeCanvasDocument(snapshot.document, options),
    lastUpdated: snapshot.updatedAt,
  } as CanvasSummary;

  if (!normalizedRoom) {
    return fallbackSummary;
  }

  if (shouldBypassSupabase) {
    logBypass('getCanvasSummary');
    return fallbackSummary;
  }

  try {
    const { data, error } = await supabase
      .from('canvases')
      .select('document, updated_at, last_modified')
      .ilike('name', `%${normalizedRoom}%`)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return fallbackSummary;
    }

    const document = (data as any)?.document ?? null;
    const summaryCore = summarizeCanvasDocument(document, options);
    const updatedAtRaw = (data as any)?.updated_at ?? (data as any)?.last_modified ?? null;
    const updatedAtNumber =
      typeof updatedAtRaw === 'string' && updatedAtRaw
        ? Number.isFinite(Date.parse(updatedAtRaw))
          ? Date.parse(updatedAtRaw)
          : null
        : typeof updatedAtRaw === 'number'
          ? updatedAtRaw
          : null;

    writeCanvasSnapshot(normalizedRoom, {
      document,
      updatedAt: updatedAtNumber ?? Date.now(),
    });

    return {
      ...summaryCore,
      lastUpdated: updatedAtRaw ?? updatedAtNumber ?? Date.now(),
    };
  } catch (error) {
    warnFallback('canvasSummary', error);
    const latestSnapshot = readCanvasSnapshot(normalizedRoom);
    const summaryCore = summarizeCanvasDocument(latestSnapshot.document, options);
    return {
      ...summaryCore,
      lastUpdated: latestSnapshot.updatedAt,
    };
  }
}

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
    const { data, error } = await supabase
      .from('canvases')
      .select('document, id')
      .ilike('name', `%${room}%`)
      .limit(1)
      .maybeSingle();

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

  let supabaseUpdated = false;

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

      supabaseUpdated = true;
    } catch (err) {
      warnFallback('commit', err);
    }
  }

  writeFallback(room, docId, nextRecord);

  return { version: nextVersion };
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
