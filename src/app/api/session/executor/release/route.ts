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
  const { sessionId, identity } = await parseExecutorBody(req);

  if (!sessionId || !identity) {
    return NextResponse.json(
      { error: 'sessionId and identity are required' },
      { status: 400 },
    );
  }

  if (usingInMemoryExecutorLeaseFallback()) {
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
    const released = currentHolder === identity;
    if (released) {
      setInMemoryExecutorLease({
        sessionId,
        roomName: current.room_name ?? null,
        identity: null,
        leaseExpiresAt: null,
        updatedAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({
      released,
      sessionId,
      fallback: 'in-memory',
    });
  }

  const { data, error } = await supabase
    .from('canvas_sessions')
    .update({
      tool_executor_identity: null,
      tool_executor_lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('tool_executor_identity', identity)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    released: Boolean(data?.id),
    sessionId,
  });
}
