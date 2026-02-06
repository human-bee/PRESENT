import { supabase } from '@/lib/supabase';

export async function getSupabaseAccessToken(): Promise<string | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function buildSupabaseAuthHeaders(
  init?: HeadersInit,
): Promise<Headers> {
  const headers = new Headers(init);
  const token = await getSupabaseAccessToken();
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

