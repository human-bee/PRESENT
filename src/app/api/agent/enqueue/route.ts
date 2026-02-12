import { NextResponse } from 'next/server';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { queueTaskEnvelopeSchema } from '@/lib/agents/shared/schemas';
import { createLogger } from '@/lib/logging';

const logger = createLogger('api:agent:enqueue');

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = queueTaskEnvelopeSchema.parse(body);

    // Lazily instantiate so `next build` doesn't require Supabase env vars.
    const queue = new AgentTaskQueue();
    const task = await queue.enqueueTask(payload);

    return NextResponse.json({ status: 'queued', task });
  } catch (error) {
    logger.error('enqueue failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 },
    );
  }
}
