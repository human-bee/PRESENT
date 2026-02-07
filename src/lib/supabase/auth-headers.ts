import { supabase } from '@/lib/supabase';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function getSupabaseAccessToken(maxWaitMs = 0): Promise<string | null> {
  try {
    const start = Date.now();
    while (true) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token ?? null;
      if (token) return token;
      if (Date.now() - start >= maxWaitMs) return null;
      await sleep(100);
    }
  } catch {
    return null;
  }
}

export async function buildSupabaseAuthHeaders(
  init?: HeadersInit,
): Promise<Headers> {
  const headers = new Headers(init);
  // During demo-mode anonymous sign-in, auth can race initial API calls.
  // Wait briefly so requests that require auth don't immediately 401.
  const token = await getSupabaseAccessToken(1500);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

export async function fetchWithSupabaseAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = await buildSupabaseAuthHeaders(init?.headers);
  return fetch(input, { ...init, headers });
}
