import { NextRequest, NextResponse } from 'next/server';
import { getDebateScorecard } from '@/lib/agents/shared/supabase-context';
import { DEV_BYPASS_ENABLED } from '@/lib/agents/shared/byok-flags';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';

export const runtime = 'nodejs';

const readOptional = (params: URLSearchParams, key: string): string | undefined => {
  const value = params.get(key);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

type MembershipStatus = 'verified' | 'dev_bypass';

export async function GET(req: NextRequest) {
  const devBypassEnabled = DEV_BYPASS_ENABLED && process.env.NODE_ENV !== 'production';
  const requesterUserId = await resolveRequestUserId(req);
  if (!requesterUserId && !devBypassEnabled) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const room = readOptional(searchParams, 'room');
  const componentId = readOptional(searchParams, 'componentId');

  if (!room || !componentId) {
    return NextResponse.json({ error: 'room and componentId are required' }, { status: 400 });
  }

  const canvasId = parseCanvasIdFromRoom(room);
  if (!canvasId) {
    return NextResponse.json({ error: 'invalid room' }, { status: 400 });
  }

  let membership: MembershipStatus = 'verified';
  if (devBypassEnabled) {
    membership = 'dev_bypass';
  } else {
    try {
      await assertCanvasMember({
        canvasId,
        requesterUserId: requesterUserId!,
      });
    } catch (membershipError) {
      const code = (membershipError as Error & { code?: string }).code;
      const message =
        membershipError instanceof Error ? membershipError.message : String(membershipError ?? '');
      if (code === 'forbidden') {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      if (/canvas not found/i.test(message)) {
        return NextResponse.json({ error: 'canvas not found' }, { status: 404 });
      } else {
        return NextResponse.json({ error: 'membership check failed' }, { status: 500 });
      }
    }
  }

  try {
    const scorecard = await getDebateScorecard(room, componentId);
    const timeline = Array.isArray(scorecard.state?.timeline) ? scorecard.state.timeline : [];
    return NextResponse.json({
      ok: true,
      room,
      componentId,
      scorecard: scorecard.state,
      timeline,
      version: scorecard.version,
      lastUpdated: scorecard.lastUpdated,
      diagnostics: {
        membership,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ error: message || 'scorecard read failed' }, { status: 500 });
    }
    return NextResponse.json({ error: 'scorecard read failed' }, { status: 500 });
  }
}
