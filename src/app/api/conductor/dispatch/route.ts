import { NextRequest, NextResponse, after } from 'next/server';
import { callConductor } from '@/lib/agents/conductor';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { task, params, room } = body || {};

    if (typeof task !== 'string' || task.trim() === '') {
      return NextResponse.json({ error: 'Missing task' }, { status: 400 });
    }

    const normalizedParams =
      params && typeof params === 'object' ? { ...(params as Record<string, unknown>) } : {};
    if (typeof room === 'string' && room.trim() !== '') {
      if (!('room' in normalizedParams) || typeof (normalizedParams as any).room !== 'string') {
        (normalizedParams as Record<string, unknown>).room = room.trim();
      }
    }

    after(async () => {
      try {
        await callConductor(task.trim(), normalizedParams);
      } catch (error) {
        console.error('[Conductor][dispatch] error', error);
      }
    });

    return NextResponse.json({ status: 'scheduled' }, { status: 202 });
  } catch (error: any) {
    console.error('[Conductor][dispatch] invalid request', error);
    return NextResponse.json({ error: error?.message || 'Bad Request' }, { status: 400 });
  }
}
