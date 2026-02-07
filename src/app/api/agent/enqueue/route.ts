import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';

const requestSchema = z.object({
  room: z.string().min(1),
  task: z.string().min(1),
  params: z.record(z.string(), z.any()).default({}),
  requestId: z.string().optional(),
  resourceKeys: z.array(z.string()).optional(),
  priority: z.number().int().min(0).default(0),
  runAt: z.coerce.date().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = requestSchema.parse(body);

    // Lazily instantiate so `next build` doesn't require Supabase env vars.
    const queue = new AgentTaskQueue();
    const task = await queue.enqueueTask(payload);

    return NextResponse.json({ status: 'queued', task });
  } catch (error) {
    console.error('[api/agent/enqueue] failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 },
    );
  }
}
