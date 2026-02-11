import { NextRequest, NextResponse } from 'next/server';
import {
  getServerClient,
  parseExecutorBody,
  readSessionLease,
} from '../shared';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const supabase = getServerClient(authHeader);
  const { sessionId, roomName, identity, leaseTtlMs } = await parseExecutorBody(req);

  if (!sessionId || !identity) {
    return NextResponse.json(
      { error: 'sessionId and identity are required' },
      { status: 400 },
    );
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const leaseExpiresAtIso = new Date(now + leaseTtlMs).toISOString();

  const { data: current, error: readErr } = await readSessionLease(supabase, sessionId);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (roomName && current.room_name && current.room_name !== roomName) {
    return NextResponse.json({ error: 'Session room mismatch' }, { status: 409 });
  }

  const currentHolder =
    typeof current.tool_executor_identity === 'string'
      ? current.tool_executor_identity
      : null;
  const currentExpiresAtMs = current.tool_executor_lease_expires_at
    ? Date.parse(current.tool_executor_lease_expires_at)
    : Number.NaN;
  const leaseActive =
    Number.isFinite(currentExpiresAtMs) && currentExpiresAtMs > now;

  if (leaseActive && currentHolder && currentHolder !== identity) {
    return NextResponse.json({
      acquired: false,
      sessionId,
      executorIdentity: currentHolder,
      leaseExpiresAt: current.tool_executor_lease_expires_at,
    });
  }

  // Compare-and-swap update: only succeed if the lease snapshot we read is still current.
  let updateQuery = supabase
    .from('canvas_sessions')
    .update({
      tool_executor_identity: identity,
      tool_executor_lease_expires_at: leaseExpiresAtIso,
      updated_at: nowIso,
    })
    .eq('id', sessionId);

  if (typeof current.updated_at === 'string' && current.updated_at.trim().length > 0) {
    updateQuery = updateQuery.eq('updated_at', current.updated_at);
  }

  if (currentHolder) {
    updateQuery = updateQuery.eq('tool_executor_identity', currentHolder);
  } else {
    updateQuery = updateQuery.is('tool_executor_identity', null);
  }

  if (typeof current.tool_executor_lease_expires_at === 'string') {
    updateQuery = updateQuery.eq(
      'tool_executor_lease_expires_at',
      current.tool_executor_lease_expires_at,
    );
  } else {
    updateQuery = updateQuery.is('tool_executor_lease_expires_at', null);
  }

  const { data: updated, error: updateErr } = await updateQuery
    .select('id, tool_executor_identity, tool_executor_lease_expires_at')
    .maybeSingle();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  if (!updated) {
    // Lost a race; report current lease holder.
    const { data: latest, error: latestErr } = await readSessionLease(supabase, sessionId);
    if (latestErr) {
      return NextResponse.json({ error: latestErr.message }, { status: 500 });
    }
    return NextResponse.json({
      acquired: latest?.tool_executor_identity === identity,
      sessionId,
      executorIdentity: latest?.tool_executor_identity ?? null,
      leaseExpiresAt: latest?.tool_executor_lease_expires_at ?? null,
    });
  }

  return NextResponse.json({
    acquired: updated?.tool_executor_identity === identity,
    sessionId,
    executorIdentity: updated?.tool_executor_identity ?? identity,
    leaseExpiresAt: updated?.tool_executor_lease_expires_at ?? leaseExpiresAtIso,
  });
}
