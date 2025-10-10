import { NextRequest, NextResponse, after } from 'next/server';
import { runCanvasSteward } from '@/lib/agents/subagents/canvas-steward';

export async function POST(req: NextRequest) {
  try {
    const { room, task, params, summary } = await req.json();
    if (typeof room !== 'string' || room.trim().length === 0) {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }

    const normalizedTask = typeof task === 'string' && task.trim() ? task.trim() : 'canvas.draw';
    const normalizedParams = Object(params) === params ? { ...params } : {};
    if (!normalizedParams.room) {
      normalizedParams.room = room.trim();
    }
    if (typeof summary === 'string' && summary.trim()) {
      normalizedParams.summary = summary.trim();
    }

    after(async () => {
      try {
        await runCanvasSteward({ task: normalizedTask, params: normalizedParams });
      } catch (error) {
        console.error('[Steward][runCanvas] error', error);
      }
    });

    return NextResponse.json({ status: 'scheduled' }, { status: 202 });
  } catch (error) {
    console.error('Invalid request to steward/runCanvas', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
