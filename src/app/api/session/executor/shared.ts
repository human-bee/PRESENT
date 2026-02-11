import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function getServerClient(authHeader?: string | null) {
  const token = authHeader?.startsWith('Bearer ') ? authHeader : undefined;
  return createClient(url, anon, {
    global: { headers: token ? { Authorization: token } : {} },
  });
}

export async function parseExecutorBody(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  const roomName = typeof body?.roomName === 'string' ? body.roomName.trim() : '';
  const identity = typeof body?.identity === 'string' ? body.identity.trim() : '';
  const leaseTtlMsRaw = typeof body?.leaseTtlMs === 'number' ? body.leaseTtlMs : 15_000;
  const leaseTtlMs = Math.max(5_000, Math.min(60_000, Math.round(leaseTtlMsRaw)));
  return { sessionId, roomName, identity, leaseTtlMs };
}

export async function readSessionLease(
  supabase: ReturnType<typeof createClient>,
  sessionId: string,
) {
  const { data, error } = await supabase
    .from('canvas_sessions')
    .select(
      'id, room_name, updated_at, tool_executor_identity, tool_executor_lease_expires_at',
    )
    .eq('id', sessionId)
    .maybeSingle();
  return { data, error };
}
