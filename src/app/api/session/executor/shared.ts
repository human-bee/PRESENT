import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type InMemoryLeaseRecord = {
  roomName: string | null;
  executorIdentity: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
};

type ExecutorLeaseRow = {
  id: string;
  room_name: string | null;
  updated_at: string | null;
  tool_executor_identity: string | null;
  tool_executor_lease_expires_at: string | null;
};

const LEASE_STORE_KEY = '__presentExecutorLeaseStore';
const g = globalThis as typeof globalThis & {
  [LEASE_STORE_KEY]?: Map<string, InMemoryLeaseRecord>;
};
const inMemoryLeaseStore = g[LEASE_STORE_KEY] ?? new Map<string, InMemoryLeaseRecord>();
if (!g[LEASE_STORE_KEY]) {
  g[LEASE_STORE_KEY] = inMemoryLeaseStore;
}

let executorLeaseColumnsMissing = false;

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
  supabase: ReturnType<typeof getServerClient>,
  sessionId: string,
) {
  if (!executorLeaseColumnsMissing) {
    const { data, error } = await supabase
      .from('canvas_sessions')
      .select(
        'id, room_name, updated_at, tool_executor_identity, tool_executor_lease_expires_at',
      )
      .eq('id', sessionId)
      .maybeSingle<ExecutorLeaseRow>();

    if (!error) {
      return { data, error };
    }

    const message = error.message ?? '';
    const missingExecutorColumns =
      /tool_executor_(identity|lease_expires_at)/i.test(message) &&
      /(does not exist|column|schema cache|could not find)/i.test(message);
    if (!missingExecutorColumns) {
      return { data: null, error };
    }

    executorLeaseColumnsMissing = true;
  }

  const { data: base, error: baseError } = await supabase
    .from('canvas_sessions')
    .select('id, room_name, updated_at')
    .eq('id', sessionId)
    .maybeSingle<{ id: string; room_name: string | null; updated_at: string | null }>();
  if (baseError || !base) {
    return { data: null, error: baseError };
  }

  const nowMs = Date.now();
  const lease = inMemoryLeaseStore.get(sessionId);
  const leaseExpiryMs =
    lease?.leaseExpiresAt && Number.isFinite(Date.parse(lease.leaseExpiresAt))
      ? Date.parse(lease.leaseExpiresAt)
      : Number.NaN;
  const leaseExpired = Number.isFinite(leaseExpiryMs) && leaseExpiryMs <= nowMs;
  if (leaseExpired) {
    inMemoryLeaseStore.delete(sessionId);
  }

  const activeLease = !leaseExpired ? lease : null;
  const data: ExecutorLeaseRow = {
    id: base.id,
    room_name: base.room_name,
    updated_at: activeLease?.updatedAt ?? base.updated_at,
    tool_executor_identity: activeLease?.executorIdentity ?? null,
    tool_executor_lease_expires_at: activeLease?.leaseExpiresAt ?? null,
  };
  return { data, error: null };
}

export function usingInMemoryExecutorLeaseFallback() {
  return executorLeaseColumnsMissing;
}

export function setInMemoryExecutorLease(params: {
  sessionId: string;
  roomName: string | null;
  identity: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
}) {
  const { sessionId, roomName, identity, leaseExpiresAt, updatedAt } = params;
  if (!identity) {
    inMemoryLeaseStore.delete(sessionId);
    return;
  }
  inMemoryLeaseStore.set(sessionId, {
    roomName,
    executorIdentity: identity,
    leaseExpiresAt,
    updatedAt,
  });
}
