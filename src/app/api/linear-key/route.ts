import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getRequestUserId } from '@/lib/supabase/server/request-user';
import { getBooleanFlag } from '@/lib/feature-flags';

export const runtime = 'nodejs';

type LinearKeyRow = {
  user_id: string;
  provider: string;
  secret: string;
  updated_at?: string;
};

const DEMO_MODE_ENABLED = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);

async function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase configuration for secure key storage');
  }

  // Service role is server-only and should never rely on cookie/session state.
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function getTestUserId(): string | null {
  if (process.env.NODE_ENV !== 'test') return null;
  const raw = process.env.TEST_USER_ID?.trim();
  return raw ? raw : null;
}

async function resolveUserId(req: NextRequest): Promise<string | null> {
  const bearer = await getRequestUserId(req);
  if (bearer.ok) return bearer.userId;

  // Fallback: cookie-based auth (legacy).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

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
  });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const devEnvKey =
      process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test'
        ? process.env.LINEAR_API_KEY?.trim() || null
        : null;

    const userId = getTestUserId() || (await resolveUserId(req));
    if (!userId) {
      if (devEnvKey) return NextResponse.json({ apiKey: devEnvKey });
      // In demo mode, treat missing auth as "no key configured" (avoid noisy 401s in the console).
      if (DEMO_MODE_ENABLED) return NextResponse.json({ apiKey: null });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await getServiceSupabase();
    const { data, error } = await supabase
      .from<LinearKeyRow>('user_secrets')
      .select('secret')
      .eq('user_id', userId)
      .eq('provider', 'linear')
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[linear-key][GET] supabase error', error);
      return NextResponse.json({ error: 'Failed to load key' }, { status: 500 });
    }

    if (!data?.secret) {
      if (devEnvKey) return NextResponse.json({ apiKey: devEnvKey });
      return NextResponse.json({ apiKey: null });
    }

    return NextResponse.json({ apiKey: data.secret });
  } catch (err: any) {
    console.error('[linear-key][GET] unexpected', err);
    return NextResponse.json({ error: err?.message || 'Failed to load key' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = getTestUserId() || (await resolveUserId(req));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { apiKey } = await req.json();
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
    }

    const supabase = await getServiceSupabase();
    const { error } = await supabase
      .from<LinearKeyRow>('user_secrets')
      .upsert(
        {
          user_id: userId,
          provider: 'linear',
          secret: apiKey.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );

    if (error) {
      console.error('[linear-key][POST] supabase error', error);
      return NextResponse.json({ error: 'Failed to save key' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[linear-key][POST] unexpected', err);
    return NextResponse.json({ error: err?.message || 'Failed to save key' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = getTestUserId() || (await resolveUserId(req));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const supabase = await getServiceSupabase();
    const { error } = await supabase
      .from<LinearKeyRow>('user_secrets')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'linear');

    if (error) {
      console.error('[linear-key][DELETE] supabase error', error);
      return NextResponse.json({ error: 'Failed to delete key' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[linear-key][DELETE] unexpected', err);
    return NextResponse.json({ error: err?.message || 'Failed to delete key' }, { status: 500 });
  }
}
