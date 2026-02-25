import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { unlockSharedKeySchema } from '@/lib/agents/control-plane/schemas';
import {
  checkUnlockRateLimit,
  createSharedUnlockSession,
  createUnlockCookieValue,
  unlockCookieName,
  validateSharedKeyPassword,
} from '@/lib/agents/control-plane/shared-keys';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { recordOpsAudit } from '@/lib/agents/shared/trace-events';

export const runtime = 'nodejs';

const readClientIp = (req: NextRequest): string | null => {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  return req.headers.get('x-real-ip');
};

export async function POST(req: NextRequest) {
  const userId = await resolveRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = unlockSharedKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', details: parsed.error.flatten() }, { status: 400 });
  }
  const roomScope = parsed.data.roomScope?.trim() || null;
  if (roomScope) {
    const canvasId = parseCanvasIdFromRoom(roomScope);
    if (canvasId) {
      try {
        await assertCanvasMember({ canvasId, requesterUserId: userId });
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'forbidden') {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        throw error;
      }
    }
  }
  const clientIp = readClientIp(req);
  const limit = await checkUnlockRateLimit({ userId, ip: clientIp });
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfterSec: limit.retryAfterSec },
      { status: 429 },
    );
  }
  const passwordCheck = await validateSharedKeyPassword(parsed.data.password);
  if (!passwordCheck.ok) {
    return NextResponse.json({ error: passwordCheck.reason || 'invalid_password' }, { status: 403 });
  }
  const session = await createSharedUnlockSession({
    userId,
    roomScope,
    ip: clientIp,
  });
  const response = NextResponse.json({
    ok: true,
    unlock: {
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      roomScope,
    },
  });
  response.cookies.set({
    name: unlockCookieName(),
    value: createUnlockCookieValue(session.token),
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    expires: new Date(session.expiresAt),
  });
  void recordOpsAudit({
    actorUserId: userId,
    action: 'model_controls.shared_key_unlock',
    reason: roomScope ? `Unlocked shared keys for room ${roomScope}` : 'Unlocked shared keys',
    afterStatus: 'ok',
    result: {
      roomScope: roomScope ?? null,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
    },
  });
  return response;
}

