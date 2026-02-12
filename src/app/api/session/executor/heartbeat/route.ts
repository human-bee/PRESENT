import { NextRequest, NextResponse } from 'next/server';
import {
  getServerClient,
  parseExecutorBody,
  readSessionLease,
  setInMemoryExecutorLease,
  usingInMemoryExecutorLeaseFallback,
} from '../shared';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const supabase = getServerClient(authHeader);
  const { sessionId, identity, leaseTtlMs } = await parseExecutorBody(req);

  if (!sessionId || !identity) {
    return NextResponse.json(
      { error: 'sessionId and identity are required' },
      { status: 400 },
    );
  }

  const { data: current, error: readErr } = await readSessionLease(supabase, sessionId);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const currentHolder =
    typeof current.tool_executor_identity === 'string'
      ? current.tool_executor_identity
      : null;
  if (currentHolder !== identity) {
    return NextResponse.json({
      ok: false,
      sessionId,
      executorIdentity: currentHolder,
      leaseExpiresAt: current.tool_executor_lease_expires_at,
    });
  }

  const now = Date.now();
  const leaseExpiresAtIso = new Date(now + leaseTtlMs).toISOString();

  if (usingInMemoryExecutorLeaseFallback()) {
    setInMemoryExecutorLease({
      sessionId,
      roomName: current.room_name ?? null,
      identity,
      leaseExpiresAt: leaseExpiresAtIso,
      updatedAt: new Date(now).toISOString(),
    });
    return NextResponse.json({
      ok: true,
      sessionId,
      executorIdentity: identity,
      leaseExpiresAt: leaseExpiresAtIso,
      fallback: 'in-memory',
    });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('canvas_sessions')
    .update({
      tool_executor_lease_expires_at: leaseExpiresAtIso,
      updated_at: new Date(now).toISOString(),
    })
    .eq('id', sessionId)
    .eq('tool_executor_identity', identity)
    .select('id, tool_executor_identity, tool_executor_lease_expires_at')
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  if (!updated) {
    const { data: latest, error: latestErr } = await readSessionLease(supabase, sessionId);
    if (latestErr) {
      return NextResponse.json({ error: latestErr.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: latest?.tool_executor_identity === identity,
      sessionId,
      executorIdentity: latest?.tool_executor_identity ?? null,
      leaseExpiresAt: latest?.tool_executor_lease_expires_at ?? null,
    });
  }

  return NextResponse.json({
    ok: true,
    sessionId,
    executorIdentity: updated?.tool_executor_identity ?? identity,
    leaseExpiresAt: updated?.tool_executor_lease_expires_at ?? leaseExpiresAtIso,
  });
}
