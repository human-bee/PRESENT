import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

type Body = { canvasId?: string; room?: string };

const parseCanvasId = (body: Body): string | null => {
  if (body.canvasId && typeof body.canvasId === 'string') return body.canvasId.trim();
  const room = body.room || '';
  const match = room.match(/^canvas-([0-9a-fA-F-]{36})$/);
  if (match?.[1]) return match[1];
  return null;
};

export async function POST(request: Request) {
  try {
    const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!NEXT_PUBLIC_SUPABASE_URL || !NEXT_PUBLIC_SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Supabase env missing' }, { status: 500 });
    }

    const body = (await request.json().catch(() => ({}))) as Body;
    const canvasId = parseCanvasId(body);
    if (!canvasId) {
      return NextResponse.json({ error: 'canvasId required' }, { status: 400 });
    }

    // Get the current user from cookies (anon key + auth cookies)
    const cookieStore = await cookies();
    const cookieHeader = typeof cookieStore.toString === 'function' ? cookieStore.toString() : '';
    const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: {
        detectSessionInUrl: false,
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Service-role client to bypass RLS for membership insert
    const admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: upsertErr } = await admin
      .from('canvas_members')
      .upsert({ canvas_id: canvasId, user_id: user.id, role: 'editor' }, { onConflict: 'canvas_id,user_id' });

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, canvasId }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'unexpected error' }, { status: 500 });
  }
}
