import { NextRequest, NextResponse } from 'next/server';
import { callConductor } from '@/lib/agents/conductor';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const task = typeof body?.task === 'string' ? body.task.trim() : '';
    const params = (body?.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>;
    if (!task) {
      return NextResponse.json({ error: 'Missing task' }, { status: 400 });
    }
    const finalOutput = await callConductor(task, params);
    return NextResponse.json({ finalOutput: finalOutput ?? null });
  } catch (error) {
    console.error('[Conductor][dispatch] error', error);
    return NextResponse.json({ error: 'Failed to dispatch task' }, { status: 500 });
  }
}
