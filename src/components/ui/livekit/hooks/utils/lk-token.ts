import type { User } from '@supabase/supabase-js';

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

export async function fetchLivekitAccessToken({
  roomName,
  identity,
  displayName,
  metadataParam,
  signal,
}: FetchTokenParams): Promise<string> {
  const response = await fetch(
    `/api/token?roomName=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}&username=${encodeURIComponent(displayName)}&name=${encodeURIComponent(displayName)}${metadataParam}`,
    { signal },
  );

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
