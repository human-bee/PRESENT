import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getBooleanFlag } from '@/lib/feature-flags';

export const runtime = 'nodejs';

const DEMO_MODE_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getServerClient(authHeader?: string | null) {
  const token = authHeader?.startsWith('Bearer ') ? authHeader : undefined;
  return createClient(url, anon, {
    global: { headers: token ? { Authorization: token } : {} },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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
  const authHeader = req.headers.get('Authorization');
  const supabase = getServerClient(authHeader);

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    sessionId: searchParams.get('sessionId'),
    limit: searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (!authHeader && DEMO_MODE_ENABLED) {
    return NextResponse.json({ transcript: [] });
  }

  const { sessionId, limit } = parsed.data;

  const { data, error } = await supabase
    .from('canvas_session_transcripts')
    .select('event_id, participant_id, participant_name, text, ts, manual')
    .eq('session_id', sessionId)
    .order('ts', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const transcript = (data || [])
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
  const authHeader = req.headers.get('Authorization');
  const supabase = getServerClient(authHeader);

  if (!authHeader && DEMO_MODE_ENABLED) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const { sessionId, entries } = parsed.data;

  const { data: session, error: sessionErr } = await supabase
    .from('canvas_sessions')
    .select('room_name')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message }, { status: 500 });
  }

  if (!session?.room_name) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const roomName = String(session.room_name);
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

  const { error } = await supabase
    .from('canvas_session_transcripts')
    .upsert(rows, { onConflict: 'event_id', ignoreDuplicates: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

