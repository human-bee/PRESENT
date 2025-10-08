import { NextRequest, NextResponse, after } from 'next/server';
import {
  type FlowchartStewardMode,
  runActiveFlowchartSteward,
} from '@/lib/agents/subagents/flowchart-steward-registry';

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
