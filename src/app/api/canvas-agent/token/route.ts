import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { mintAgentToken } from '@/lib/agents/canvas-agent/server/auth/agentTokens';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { getRequestUserId } from '@/lib/supabase/server/request-user';

const QuerySchema = z.object({
  sessionId: z.string().min(1),
  roomId: z.string().min(1),
});

const ROOM_ID_REGEX = /^canvas-([a-zA-Z0-9_-]+)$/;
const DEV_BYPASS_ENABLED =
  process.env.NEXT_PUBLIC_CANVAS_DEV_BYPASS === 'true' || process.env.CANVAS_DEV_BYPASS === 'true';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    sessionId: url.searchParams.get('sessionId'),
    roomId: url.searchParams.get('roomId'),
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const match = ROOM_ID_REGEX.exec(parsed.data.roomId.trim());
  if (!match) {
    return NextResponse.json({ ok: false, error: 'invalid_room' }, { status: 400 });
  }
  const canvasId = match[1];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnon || !supabaseServiceKey) {
    return NextResponse.json({ ok: false, error: 'misconfigured' }, { status: 500 });
  }

  // Prefer bearer auth (browser sessions are stored in localStorage, not SSR cookies).
  let sessionUserId: string | null = null;
  const bearerUser = await getRequestUserId(req);
  if (bearerUser.ok) {
    sessionUserId = bearerUser.userId;
  } else {
    // Fallback: cookie-based auth (local dev / legacy flows).
    const cookieStore = await cookies();
    const supabase = createServerClient(supabaseUrl, supabaseAnon, {
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
    });
    const {
      data: { session },
    } = await supabase.auth.getSession();
    sessionUserId = session?.user?.id ?? null;
  }

  if (!sessionUserId && !DEV_BYPASS_ENABLED) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: canvas, error: canvasErr } = await admin
    .from('canvases')
    .select('id, user_id, is_public')
    .eq('id', canvasId)
    .maybeSingle();

  if (canvasErr && !DEV_BYPASS_ENABLED) {
    console.error('Canvas lookup failed', canvasErr);
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }

  if (!canvas && !DEV_BYPASS_ENABLED) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  if (!DEV_BYPASS_ENABLED && canvas && !canvas.is_public && sessionUserId && canvas.user_id !== sessionUserId) {
    const { data: member, error: memberErr } = await admin
      .from('canvas_members')
      .select('canvas_id')
      .eq('canvas_id', canvasId)
      .eq('user_id', sessionUserId)
      .maybeSingle();

    if (memberErr) {
      console.error('Canvas membership lookup failed', memberErr);
      return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
    }

    if (!member) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 });
    }
  }

  const exp = Date.now() + 120_000;
  const token = mintAgentToken({ ...parsed.data, exp });
  return NextResponse.json({ ok: true, token, exp });
}
