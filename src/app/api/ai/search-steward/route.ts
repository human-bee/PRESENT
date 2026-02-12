import { NextRequest, NextResponse } from 'next/server';
import { runSearchSteward } from '@/lib/agents/subagents/search-steward';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { task, params } = body;

    if (!task) {
      return NextResponse.json(
        { status: 'error', error: 'Missing task' },
        { status: 400 }
      );
    }

    const nextParams = (params && typeof params === 'object') ? { ...params } : {};

    if (BYOK_ENABLED) {
      const requesterUserId = await resolveRequestUserId(req);
      if (!requesterUserId) {
        return NextResponse.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
      }
      const roomName = typeof (nextParams as any).room === 'string' ? String((nextParams as any).room).trim() : '';
      const canvasId = roomName ? parseCanvasIdFromRoom(roomName) : null;
      if (canvasId) {
        try {
          const membership = await assertCanvasMember({ canvasId, requesterUserId });
          (nextParams as any).billingUserId = membership.ownerUserId;
        } catch (error) {
          const code = (error as Error & { code?: string }).code;
          if (code === 'forbidden') {
            return NextResponse.json({ status: 'error', error: 'forbidden' }, { status: 403 });
          }
          throw error;
        }
      } else {
        (nextParams as any).billingUserId = requesterUserId;
      }
    }

    const result = await runSearchSteward({ task, params: nextParams || {} });

    return NextResponse.json({ status: 'ok', result });
  } catch (error) {
    console.error('[SearchSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}




