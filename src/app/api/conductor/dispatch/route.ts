import { NextRequest, NextResponse, after } from 'next/server';
import { callConductor } from '@/lib/agents/conductor/index';

export async function POST(req: NextRequest) {
  try {
    const { task, params } = await req.json();
    if (typeof task !== 'string') {
      return NextResponse.json({ error: 'Missing task' }, { status: 400 });
    }

    const trimmedTask = task.trim();
    if (!trimmedTask) {
      return NextResponse.json({ error: 'Missing task' }, { status: 400 });
    }

    const payload = params && typeof params === 'object' ? (params as Record<string, unknown>) : {};

    after(async () => {
      try {
        console.log('[Conductor][api] dispatch', { task: trimmedTask, payload });
        const finalOutput = await callConductor(trimmedTask, payload);
        console.log('[Conductor][api] completed', { task: trimmedTask, finalOutput });
      } catch (error) {
        console.error('[Conductor][api] failed', { task: trimmedTask, error });
      }
    });

    return NextResponse.json({ status: 'scheduled' }, { status: 202 });
  } catch (error) {
    console.error('[Conductor][api] invalid request', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
