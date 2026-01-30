import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

const JOURNEY_SECRET = process.env.JOURNEY_LOGGING_SECRET;
const ALLOW_MEMORY_FALLBACK =
  process.env.JOURNEY_LOGGING_ALLOW_MEMORY_FALLBACK !== 'false' &&
  process.env.NODE_ENV !== 'production';

type JourneyEvent = {
  eventType: string;
  source?: string;
  tool?: string;
  durationMs?: number;
  payload?: Record<string, unknown>;
  assetPath?: string;
};

type JourneyRow = {
  run_id: string;
  room_name: string | null;
  event_type: string;
  source: string | null;
  tool: string | null;
  duration_ms: number | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const MEMORY_KEY = '__present_journey_events__';
const MEMORY_MAX_EVENTS = 5000;

const getMemoryStore = (): Map<string, JourneyRow[]> => {
  const root = globalThis as any;
  if (!root[MEMORY_KEY]) {
    root[MEMORY_KEY] = new Map<string, JourneyRow[]>();
  }
  return root[MEMORY_KEY] as Map<string, JourneyRow[]>;
};

const createSupabase = () => {
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
};

const shouldFallbackToMemory = (message?: string | null) => {
  if (!ALLOW_MEMORY_FALLBACK) return false;
  if (!message) return true;
  const normalized = message.toLowerCase();
  return (
    (normalized.includes('present_journey_events') &&
      normalized.includes('does not exist')) ||
    normalized.includes('fetch failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('econnrefused')
  );
};

export async function POST(req: Request) {
  if (JOURNEY_SECRET) {
    const secret = req.headers.get('x-journey-secret');
    if (secret !== JOURNEY_SECRET) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const runId = typeof body?.runId === 'string' ? body.runId.trim() : '';
  if (!runId) {
    return NextResponse.json({ ok: false, error: 'run_id_required' }, { status: 400 });
  }

  const roomName = typeof body?.roomName === 'string' ? body.roomName.trim() : null;
  const eventsRaw = Array.isArray(body?.events) ? body.events : [];
  const events = eventsRaw
    .filter((event: JourneyEvent) => event && typeof event.eventType === 'string')
    .map((event: JourneyEvent) => ({
      run_id: runId,
      room_name: roomName,
      event_type: event.eventType,
      source: event.source ?? null,
      tool: event.tool ?? null,
      duration_ms: typeof event.durationMs === 'number' ? Math.round(event.durationMs) : null,
      payload: event.payload ?? null,
      created_at: new Date().toISOString(),
    }));

  if (events.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  const supabase = createSupabase();
  if (!supabase) {
    const store = getMemoryStore();
    const existing = store.get(runId) ?? [];
    const next = [...existing, ...events].slice(-MEMORY_MAX_EVENTS);
    store.set(runId, next);
    return NextResponse.json({ ok: true, inserted: events.length, stored: 'memory' });
  }

  const { error } = await supabase.from('present_journey_events').insert(events);
  if (error) {
    if (shouldFallbackToMemory(error.message)) {
      const store = getMemoryStore();
      const existing = store.get(runId) ?? [];
      const next = [...existing, ...events].slice(-MEMORY_MAX_EVENTS);
      store.set(runId, next);
      return NextResponse.json({ ok: true, inserted: events.length, stored: 'memory' });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: events.length });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get('runId')?.trim() || '';
  if (!runId) {
    return NextResponse.json({ ok: false, error: 'run_id_required' }, { status: 400 });
  }

  const supabase = createSupabase();
  if (!supabase) {
    const store = getMemoryStore();
    const events = store.get(runId) ?? [];
    return NextResponse.json({ ok: true, events });
  }

  const limit = Number(url.searchParams.get('limit') || 2000);
  const { data, error } = await supabase
    .from('present_journey_events')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true })
    .limit(Number.isFinite(limit) ? Math.min(limit, 5000) : 2000);

  if (error) {
    if (shouldFallbackToMemory(error.message)) {
      const store = getMemoryStore();
      const events = store.get(runId) ?? [];
      return NextResponse.json({ ok: true, events });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, events: data ?? [] });
}
