import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export type RequestUserResult =
  | { ok: true; userId: string }
  | { ok: false; error: 'unauthorized' | 'misconfigured' };

function readBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function getRequestUserId(req: NextRequest): Promise<RequestUserResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { ok: false, error: 'misconfigured' };
  }

  const jwt = readBearerToken(req);
  if (!jwt) {
    return { ok: false, error: 'unauthorized' };
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user?.id) {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: true, userId: data.user.id };
}

