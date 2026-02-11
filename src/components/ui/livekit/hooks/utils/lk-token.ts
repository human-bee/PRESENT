import type { User } from '@supabase/supabase-js';
import { getSupabaseAccessToken } from '@/lib/supabase/auth-headers';
import { resolveEdgeIngressUrl } from '@/lib/edge-ingress';

interface FetchTokenParams {
  roomName: string;
  identity: string;
  displayName: string;
  metadataParam: string;
  signal: AbortSignal;
}

export function buildMetadataParam(displayName: string, user: User | null | undefined): string {
  const metadataPayload = {
    displayName,
    fullName: displayName,
    userId: user?.id ?? undefined,
  };

  return `&metadata=${encodeURIComponent(JSON.stringify(metadataPayload))}`;
}

function randomNonce() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sha256Hex(input: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildLivekitTokenHeaders(args: {
  roomName: string;
  identity: string;
  pathname?: string;
  init?: HeadersInit;
}): Promise<Headers> {
  const token = await getSupabaseAccessToken(1_500);
  if (!token) {
    throw new Error('Missing Supabase auth token for LiveKit token minting');
  }

  const timestamp = Date.now().toString();
  const nonce = randomNonce();
  const pathname = args.pathname || '/api/token';
  const payload = ['GET', pathname, args.roomName, args.identity, timestamp, nonce].join('.');
  const signature = await sha256Hex(`${token}.${payload}`);

  const headers = new Headers(args.init);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('x-timestamp', timestamp);
  headers.set('x-nonce', nonce);
  headers.set('x-signature', signature);
  return headers;
}

export async function fetchLivekitAccessToken({
  roomName,
  identity,
  displayName,
  metadataParam,
  signal,
}: FetchTokenParams): Promise<string> {
  const headers = await buildLivekitTokenHeaders({ roomName, identity, pathname: '/api/token' });
  const endpoint = resolveEdgeIngressUrl('/api/token');
  const separator = endpoint.includes('?') ? '&' : '?';
  const tokenUrl = `${endpoint}${separator}roomName=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}&username=${encodeURIComponent(displayName)}&name=${encodeURIComponent(displayName)}${metadataParam}`;
  const response = await fetch(tokenUrl, { signal, headers });

  if (!response.ok) {
    throw new Error(`Token fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const token = data.accessToken || data.token;

  if (!token) {
    throw new Error('No token received from API');
  }

  return token;
}
