import type { InterviewEnvelope } from '@present/contracts/interviews';

export async function briefRequest<T>(url: string, token = '', body?: unknown, identity?: string): Promise<T> {
  let accessToken = token;
  if (!accessToken && url === '/api/interviews' && process.env.NODE_ENV === 'production') {
    const { getSupabaseAccessToken } = await import('@/lib/supabase/auth-headers');
    accessToken = await getSupabaseAccessToken(1500) || '';
  }
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(identity ? { 'x-brief-participant': identity } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error || 'Could not reach the shared brief. Please try again.');
  }
  return response.json() as Promise<T>;
}

export type BriefSession = { token: string; interview: InterviewEnvelope };
export const briefPath = (id: string, token: string) => `/interviews?brief=${encodeURIComponent(id)}#access=${encodeURIComponent(token)}`;
let exampleRequest: Promise<BriefSession> | undefined;
export function openExampleInterview() {
  exampleRequest ??= briefRequest<BriefSession>('/api/interviews', '', { example: true }).catch((error) => {
    exampleRequest = undefined;
    throw error;
  });
  return exampleRequest;
}
