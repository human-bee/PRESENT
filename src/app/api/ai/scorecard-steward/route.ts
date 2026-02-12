import { NextRequest, NextResponse } from 'next/server';
import { isFastStewardReady } from '@/lib/agents/fast-steward-config';
import { runDebateScorecardStewardFast } from '@/lib/agents/subagents/debate-steward-fast';
import { runDebateScorecardSteward } from '@/lib/agents/debate-judge';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { getDecryptedUserModelKey } from '@/lib/agents/shared/user-model-keys';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { task, room, componentId, intent, summary, prompt } = body;

    let billingUserId: string | null = null;
    if (BYOK_ENABLED) {
      const requesterUserId = await resolveRequestUserId(req);
      if (!requesterUserId) {
        return NextResponse.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
      }
      const roomName = typeof room === 'string' ? room.trim() : '';
      const canvasId = roomName ? parseCanvasIdFromRoom(roomName) : null;
      if (canvasId) {
        try {
          const membership = await assertCanvasMember({ canvasId, requesterUserId });
          billingUserId = membership.ownerUserId;
        } catch (error) {
          const code = (error as Error & { code?: string }).code;
          if (code === 'forbidden') {
            return NextResponse.json({ status: 'error', error: 'forbidden' }, { status: 403 });
          }
          throw error;
        }
      } else {
        billingUserId = requesterUserId;
      }
    }

    // Route fact_check to the full SOTA steward, other tasks to FAST (Cerebras) when configured.
    const cerebrasKey =
      BYOK_ENABLED && billingUserId
        ? await getDecryptedUserModelKey({ userId: billingUserId, provider: 'cerebras' })
        : null;
    const useFast = task !== 'scorecard.fact_check' && isFastStewardReady(cerebrasKey ?? undefined);

    let result;
    if (useFast) {
      result = await runDebateScorecardStewardFast({
        room,
        componentId,
        intent,
        summary,
        prompt,
        ...(billingUserId ? { billingUserId } : {}),
      });
    } else {
      result = await runDebateScorecardSteward({
        room,
        componentId,
        intent,
        summary,
        prompt,
        ...(billingUserId ? { billingUserId } : {}),
      });
    }

    return NextResponse.json({ status: 'ok', result });
  } catch (error) {
    console.error('[ScorecardSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}



