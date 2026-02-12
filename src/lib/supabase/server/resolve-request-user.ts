import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getRequestUserId } from './request-user';

/**
 * Resolve the authenticated Supabase user id for a Next.js route handler.
 *
 * Primary path: Bearer token (browser sessions are stored in localStorage, not SSR cookies).
 * Fallback: cookie-based auth (local dev / legacy flows).
 *
 * In tests, supports `TEST_USER_ID` injection.
 */
export async function resolveRequestUserId(req: NextRequest): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.TEST_USER_ID) {
    return process.env.TEST_USER_ID;
  }

  const bearer = await getRequestUserId(req);
  if (bearer.ok) return bearer.userId;

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

