import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

export type ResolvedRequestUser = {
  id: string;
  email: string | null;
};

/**
 * Resolve the authenticated Supabase user id for a Next.js route handler.
 *
 * Primary path: Bearer token (browser sessions are stored in localStorage, not SSR cookies).
 * Fallback: cookie-based auth (local dev / legacy flows).
 *
 * In tests, supports `TEST_USER_ID` injection.
 */
export async function resolveRequestUserId(req: NextRequest): Promise<string | null> {
  const user = await resolveRequestUser(req);
  return user?.id ?? null;
}

export async function resolveRequestUser(
  req: NextRequest,
): Promise<ResolvedRequestUser | null> {
  if (process.env.NODE_ENV === 'test' && process.env.TEST_USER_ID) {
    return { id: process.env.TEST_USER_ID, email: null };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearerToken) {
    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.getUser(bearerToken);
    if (!error && data?.user?.id) {
      return {
        id: data.user.id,
        email: data.user?.email ?? null,
      };
    }
  }

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

  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
  };
}
