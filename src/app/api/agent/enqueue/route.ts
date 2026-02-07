import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AgentTaskQueue } from '@/lib/agents/shared/queue';
import { BYOK_ENABLED } from '@/lib/agents/shared/byok-flags';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';

export const runtime = 'nodejs';

let queue: AgentTaskQueue | null = null;
const getQueue = () => {
  if (!queue) queue = new AgentTaskQueue();
  return queue;
};
const requestSchema = z.object({
  room: z.string().min(1),
  task: z.string().min(1),
  params: z.record(z.string(), z.any()).default({}),
  requestId: z.string().optional(),
  resourceKeys: z.array(z.string()).optional(),
  priority: z.number().int().min(0).default(0),
  runAt: z.coerce.date().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = queueTaskEnvelopeSchema.parse(body);

    // Lazily instantiate so `next build` doesn't require Supabase env vars.
    if (BYOK_ENABLED) {
      const requesterUserId = await resolveRequestUserId(request);
      if (!requesterUserId) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      const roomName = payload.room.trim();
      const canvasId = parseCanvasIdFromRoom(roomName);
      if (!canvasId) {
        return NextResponse.json({ error: 'invalid_room' }, { status: 400 });
      }
      try {
        const membership = await assertCanvasMember({ canvasId, requesterUserId });
        (payload.params as any).billingUserId = membership.ownerUserId;
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        if (code === 'forbidden') {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        throw error;
      }
    }

    const task = await getQueue().enqueueTask(payload);

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
