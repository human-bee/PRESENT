import { NextRequest, NextResponse } from 'next/server';
import { runSearchSteward } from '@/lib/agents/subagents/search-steward';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { getUnlockCookieToken, validateSharedUnlockSession } from '@/lib/agents/control-plane/shared-keys';
import type { JsonObject } from '@/lib/utils/json-schema';

type SearchStewardRequestBody = {
  task?: unknown;
  params?: unknown;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SearchStewardRequestBody;
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    const params =
      body.params && typeof body.params === 'object' && !Array.isArray(body.params)
        ? (body.params as JsonObject)
        : ({} as JsonObject);

    if (!task) {
      return NextResponse.json(
        { status: 'error', error: 'Missing task' },
        { status: 400 }
      );
    }

    const nextParams: JsonObject = { ...params };
    delete nextParams.billingUserId;
    delete nextParams.requesterUserId;
    delete nextParams.sharedUnlockSessionId;

    const requesterUserId = await resolveRequestUserId(req);
    if (requesterUserId) {
      nextParams.requesterUserId = requesterUserId;
    }
    if (BYOK_ENABLED) {
      if (!requesterUserId) {
        return NextResponse.json({ status: 'error', error: 'unauthorized' }, { status: 401 });
      }
      const roomName = typeof nextParams.room === 'string' ? String(nextParams.room).trim() : '';
      const unlock = await validateSharedUnlockSession({
        token: getUnlockCookieToken(req),
        userId: requesterUserId,
        roomScope: roomName || null,
      }).catch(() => ({ ok: false as const }));
      if (unlock.ok && unlock.sessionId) {
        nextParams.sharedUnlockSessionId = unlock.sessionId;
      }
      const canvasId = roomName ? parseCanvasIdFromRoom(roomName) : null;
      if (canvasId) {
        try {
          const membership = await assertCanvasMember({ canvasId, requesterUserId });
          nextParams.billingUserId = membership.ownerUserId;
        } catch (error) {
          const code = (error as Error & { code?: string }).code;
          if (code === 'forbidden') {
            return NextResponse.json({ status: 'error', error: 'forbidden' }, { status: 403 });
          }
          throw error;
        }
      } else {
        nextParams.billingUserId = requesterUserId;
      }
    }

    const result = await runSearchSteward({ task, params: nextParams });

    return NextResponse.json({ status: 'ok', result });
  } catch (error) {
    console.error('[SearchSteward API] Error:', error);
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
