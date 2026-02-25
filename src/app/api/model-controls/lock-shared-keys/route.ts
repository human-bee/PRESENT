import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { getUnlockCookieToken, revokeSharedUnlockSession, unlockCookieName } from '@/lib/agents/control-plane/shared-keys';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = await resolveRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = getUnlockCookieToken(req);
  await revokeSharedUnlockSession(token);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: unlockCookieName(),
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    expires: new Date(0),
  });
  void recordOpsAudit({
    actorUserId: userId,
    action: 'model_controls.shared_key_lock',
    reason: 'Revoked shared key unlock session',
    afterStatus: 'ok',
  });
  return response;
}

