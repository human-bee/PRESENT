import { NextRequest, NextResponse, after } from 'next/server';
import { dispatchConductorTask } from '@/lib/agents/conductor';

export async function POST(req: NextRequest) {
  try {
    const { room, task, params, summary, message } = await req.json();
    if (typeof room !== 'string' || room.trim().length === 0) {
      return NextResponse.json({ error: 'Missing room' }, { status: 400 });
    }

    const normalizedTask = typeof task === 'string' && task.trim() ? task.trim() : 'canvas.agent_prompt';
    const normalizedParams = Object(params) === params ? { ...params } : {};
    const trimmedRoom = room.trim();

    if (!normalizedParams.room) {
      normalizedParams.room = trimmedRoom;
    } else if (typeof normalizedParams.room === 'string') {
      const candidate = normalizedParams.room.trim();
      if (!candidate || candidate === 'CURRENT_ROOM' || candidate === 'ROOM_NAME_PLACEHOLDER') {
        normalizedParams.room = trimmedRoom;
      } else {
        normalizedParams.room = candidate;
      }
    } else {
      normalizedParams.room = trimmedRoom;
    }

    if (typeof message === 'string' && message.trim()) {
      normalizedParams.message = message.trim();
    }

    if (typeof summary === 'string' && summary.trim()) {
      normalizedParams.summary = summary.trim();
    }

    if (normalizedTask === 'canvas.agent_prompt' && !normalizedParams.message) {
      return NextResponse.json({ error: 'Missing message for canvas.agent_prompt' }, { status: 400 });
    }

    after(async () => {
      try {
        await dispatchConductorTask(normalizedTask, normalizedParams);
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
