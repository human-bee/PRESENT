import { NextRequest, NextResponse, after } from 'next/server';
import { callConductor } from '@/lib/agents/conductor';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawTask = typeof body?.task === 'string' ? body.task.trim() : '';
    if (!rawTask) {
      return NextResponse.json({ error: 'Missing task' }, { status: 400 });
    }
    const params =
      body?.params && typeof body.params === 'object' && !Array.isArray(body.params)
        ? (body.params as Record<string, unknown>)
        : {};

    after(async () => {
      try {
        console.log('[Steward][handoff] scheduled', {
          task: rawTask,
          keys: Object.keys(params),
        });
        await callConductor(rawTask, params);
        console.log('[Steward][handoff] completed', { task: rawTask });
      } catch (error) {
        console.error('[Steward][handoff] error', { task: rawTask, error });
      }
    });

    return NextResponse.json({ status: 'scheduled' }, { status: 202 });
  } catch (error) {
    console.error('Invalid request to steward/handoff', error);
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }
}
