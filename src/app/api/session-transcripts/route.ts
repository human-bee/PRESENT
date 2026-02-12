import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getBooleanFlag } from '@/lib/feature-flags';

export const runtime = 'nodejs';

const DEMO_MODE_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);
const TRANSCRIPT_RETENTION_DAYS = Math.max(
  1,
  Number(process.env.TRANSCRIPT_RETENTION_DAYS ?? 30),
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getServerClient(req: NextRequest): Promise<{
  // This route uses ad-hoc tables without generated Database types.
  // Treat the Supabase client as untyped to avoid `never` query results.
  supabase: any;
  isAuthenticated: boolean;
}> {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader : null;

  if (token) {
    return {
      supabase: createClient(url, anon, {
        global: { headers: { Authorization: token } },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
      isAuthenticated: true,
    };
  }

  // Fallback: cookie-based auth (local dev / legacy flows). If no session exists, fail closed.
  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: any) {
        cookieStore.set({ name, value: '', ...options });
      },
    },
  }) as unknown as ReturnType<typeof createClient>;

  const {
    data: { session },
  } = await (supabase as any).auth.getSession();

  return { supabase, isAuthenticated: Boolean(session?.user?.id) };
}

const QuerySchema = z.object({
  sessionId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(500).default(120),
});

const EntrySchema = z
  .object({
    eventId: z.string().min(8),
    participantId: z.string().min(1),
    participantName: z.string().trim().min(1).nullable().optional(),
    text: z.string().trim().min(1).max(8_000),
    timestamp: z.number().int().nonnegative(),
    manual: z.boolean().optional(),
  })
  .strict();

const PostSchema = z
  .object({
    sessionId: z.string().uuid(),
    entries: z.array(EntrySchema).min(1).max(25),
  })
  .strict();

export async function GET(req: NextRequest) {
  const { supabase, isAuthenticated } = await getServerClient(req);

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    sessionId: searchParams.get('sessionId'),
    limit: searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!isAuthenticated && DEMO_MODE_ENABLED) {
    return NextResponse.json({ transcript: [] });
  }
  if (!isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId, limit } = parsed.data;
  const retentionCutoff = Date.now() - TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const { data, error } = await supabase
    .from('canvas_session_transcripts')
    .select('event_id, participant_id, participant_name, text, ts, manual')
    .eq('session_id', sessionId)
    .gte('ts', retentionCutoff)
    .order('ts', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type TranscriptRow = {
    event_id: string;
    participant_id: string;
    participant_name: string | null;
    text: string;
    ts: number;
    manual: boolean | null;
  };

  const rows = (data ?? []) as unknown as TranscriptRow[];
  const transcript = rows
    .slice()
    .reverse()
    .map((row) => ({
      eventId: row.event_id as string,
      participantId: row.participant_id as string,
      participantName: row.participant_name as string | null,
      text: row.text as string,
      timestamp: row.ts as number,
      manual: Boolean(row.manual),
    }));

  return NextResponse.json({ transcript });
}

export async function POST(req: NextRequest) {
  const { supabase, isAuthenticated } = await getServerClient(req);

  if (!isAuthenticated && DEMO_MODE_ENABLED) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  if (!isAuthenticated) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { sessionId, entries } = parsed.data;
  const retentionCutoff = Date.now() - TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const { data: session, error: sessionErr } = await supabase
    .from('canvas_sessions')
    .select('room_name')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  }

  type SessionRow = { room_name: string | null };
  const sessionRow = session as unknown as SessionRow | null;

  if (!sessionRow?.room_name) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const roomName = String(sessionRow.room_name);
  const rows = entries.map((entry) => ({
    event_id: entry.eventId,
    session_id: sessionId,
    room_name: roomName,
    participant_id: entry.participantId,
    participant_name: entry.participantName ?? null,
    text: entry.text,
    ts: entry.timestamp,
    manual: entry.manual ?? false,
  }));

  const freshRows = rows.filter((row) => Number.isFinite(row.ts) && row.ts >= retentionCutoff);
  if (freshRows.length === 0) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Opportunistic cleanup keeps transcript storage bounded without a dedicated cron.
  void supabase
    .from('canvas_session_transcripts')
    .delete()
    .eq('session_id', sessionId)
    .lt('ts', retentionCutoff);

  const { error } = await supabase
    .from('canvas_session_transcripts')
    .upsert(freshRows, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
