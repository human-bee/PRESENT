import { NextRequest, NextResponse } from 'next/server';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { assertCanvasMember, parseCanvasIdFromRoom } from '@/lib/agents/shared/canvas-billing';
import { resolveRequestUserId } from '@/lib/supabase/server/resolve-request-user';

export const runtime = 'nodejs';

const readOptional = (params: URLSearchParams, key: string): string | undefined => {
  const value = params.get(key);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export async function GET(req: NextRequest) {
  const userId = await resolveRequestUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const taskId = readOptional(searchParams, 'taskId');
  const room = readOptional(searchParams, 'room');

  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  const db = getAdminSupabaseClient();
  const { data: task, error } = await db
    .from('agent_tasks')
    .select('id, room, task, status, attempt, error, result, request_id, created_at, updated_at')
    .eq('id', taskId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: 'task not found' }, { status: 404 });
  }

  const taskRoom = typeof task.room === 'string' ? task.room.trim() : '';
  if (!taskRoom) {
    return NextResponse.json({ error: 'task room missing' }, { status: 500 });
  }
  if (room && room !== taskRoom) {
    return NextResponse.json({ error: 'task room mismatch' }, { status: 403 });
  }

  const canvasId = parseCanvasIdFromRoom(taskRoom);
  if (!canvasId) {
    return NextResponse.json({ error: 'invalid task room' }, { status: 400 });
  }

  try {
    await assertCanvasMember({
      canvasId,
      requesterUserId: userId,
    });
  } catch (membershipError) {
    const code = (membershipError as Error & { code?: string }).code;
    if (code === 'forbidden') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json(
      {
        error:
          membershipError instanceof Error ? membershipError.message : 'membership check failed',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    task: {
      id: task.id,
      room: task.room,
      task: task.task,
      status: task.status,
      attempt: task.attempt,
      error: task.error,
      result: task.result,
      requestId: task.request_id,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    },
  });
}
