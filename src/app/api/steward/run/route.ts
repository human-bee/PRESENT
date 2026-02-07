import { NextRequest, NextResponse, after } from 'next/server';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import {
  type FlowchartStewardMode,
  runActiveFlowchartSteward,
} from '@/lib/agents/subagents/flowchart-steward-registry';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';

export async function POST(req: NextRequest) {
  try {
    const { room, docId, windowMs, mode, reason } = await req.json();

    if (typeof room !== 'string' || typeof docId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid room/docId' }, { status: 400 });
    }

    const trimmedRoom = room.trim();
    const trimmedDocId = docId.trim();
    if (!trimmedRoom || !trimmedDocId) {
      return NextResponse.json({ error: 'Missing or invalid room/docId' }, { status: 400 });
    }

    let billingUserId: string | null = null;
    if (BYOK_ENABLED) {
      const requesterUserId = await resolveRequestUserId(req);
      if (!requesterUserId) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const canvasId = parseCanvasIdFromRoom(trimmedRoom);
      if (!canvasId) {
        return NextResponse.json({ error: 'invalid_room' }, { status: 400 });
      }
      try {
        const membership = await assertCanvasMember({ canvasId, requesterUserId });
        billingUserId = membership.ownerUserId;
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'forbidden') {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        throw error;
      }
    }

    const resolvedWindow = windowMs === undefined ? undefined : Number(windowMs);
    if (resolvedWindow !== undefined && Number.isNaN(resolvedWindow)) {
      return NextResponse.json({ error: 'Invalid windowMs value' }, { status: 400 });
    }

    const rawMode = typeof mode === 'string' ? mode.trim().toLowerCase() : undefined;
    const allowedModes: FlowchartStewardMode[] = ['auto', 'fast', 'slow'];
    const normalizedMode = rawMode && allowedModes.includes(rawMode as FlowchartStewardMode)
      ? (rawMode as FlowchartStewardMode)
      : undefined;
    if (rawMode && !normalizedMode) {
      return NextResponse.json({ error: 'Invalid mode value' }, { status: 400 });
    }

    const normalizedReason =
      typeof reason === 'string' && reason.trim().length > 0 ? reason.trim().slice(0, 120) : undefined;

    after(async () => {
      try {
        console.log('[Steward][run] scheduled', {
          room: trimmedRoom,
          docId: trimmedDocId,
          windowMs: resolvedWindow,
          mode: normalizedMode ?? 'auto',
          reason: normalizedReason,
        });
        await runActiveFlowchartSteward({
          room: trimmedRoom,
          docId: trimmedDocId,
          windowMs: resolvedWindow,
          mode: normalizedMode,
          ...(billingUserId ? { billingUserId } : {}),
        });
        console.log('[Steward][run] completed', {
          room: trimmedRoom,
          docId: trimmedDocId,
          windowMs: resolvedWindow,
          mode: normalizedMode ?? 'auto',
          reason: normalizedReason,
        });
      } catch (error) {
        console.error('[Steward][run] error', {
          room: trimmedRoom,
          docId: trimmedDocId,
          windowMs: resolvedWindow,
          mode: normalizedMode ?? 'auto',
          reason: normalizedReason,
          error,
        });
      }
    });

    return NextResponse.json({ status: 'scheduled' }, { status: 202 });
  } catch (error) {
    console.error('Invalid request to steward/run', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
