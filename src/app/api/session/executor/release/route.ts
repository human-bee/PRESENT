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
      // Best-effort release: treat read failures as non-fatal to avoid noisy unload loops.
      return NextResponse.json({
        released: false,
        sessionId,
        reason: 'best_effort_read_failed',
      });
    }
    if (!current) {
      return NextResponse.json({ released: false, sessionId, reason: 'session_not_found' });
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
    const code = (error as { code?: string }).code;
    const message = String(error.message || '').toLowerCase();
    const noMatchingLease =
      code === 'PGRST116' ||
      message.includes('0 rows') ||
      message.includes('no rows') ||
      message.includes('results contain 0 rows');
    if (noMatchingLease) {
      return NextResponse.json({
        released: false,
        sessionId,
        reason: 'lease_not_owned_or_already_released',
      });
    }
    return NextResponse.json({
      released: false,
      sessionId,
      reason: 'best_effort_release_failed',
    });
  }

  return NextResponse.json({
    released: Boolean(data?.id),
    sessionId,
  });
}
