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

const toTaskPayload = (task: {
  id: unknown;
  room: unknown;
  task: unknown;
  status: unknown;
  attempt: unknown;
  error: unknown;
  result: unknown;
  request_id: unknown;
  trace_id?: unknown;
  resolved_trace_id?: unknown;
  created_at: unknown;
  updated_at: unknown;
}) => ({
  id: task.id,
  room: task.room,
  task: task.task,
  status: task.status,
  attempt: task.attempt,
  error: task.error,
  result: task.result,
  requestId: task.request_id,
  traceId: task.trace_id ?? task.resolved_trace_id ?? null,
  traceIntegrity:
    typeof task.trace_id === 'string' && task.trace_id.trim().length > 0
      ? 'direct'
      : typeof task.resolved_trace_id === 'string' && task.resolved_trace_id.trim().length > 0
        ? 'resolved_from_events'
        : 'missing',
  createdAt: task.created_at,
  updatedAt: task.updated_at,
});

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
    .select('id, room, task, status, attempt, error, result, request_id, trace_id, created_at, updated_at')
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

  const readTrace = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const directTraceId = readTrace(task.trace_id);
  let resolvedTraceId = directTraceId;
  if (!resolvedTraceId) {
    const requestId = typeof task.request_id === 'string' ? task.request_id.trim() : '';
    const traceCandidates: string[] = [];

    const taskTraceQuery = await db
      .from('agent_trace_events')
      .select('trace_id')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(3);
    if (!taskTraceQuery.error && Array.isArray(taskTraceQuery.data)) {
      for (const row of taskTraceQuery.data) {
        const candidate = readTrace((row as Record<string, unknown>).trace_id);
        if (candidate) traceCandidates.push(candidate);
      }
    }

    if (traceCandidates.length === 0 && requestId) {
      const requestTraceQuery = await db
        .from('agent_trace_events')
        .select('trace_id')
        .eq('request_id', requestId)
        .order('created_at', { ascending: false })
        .limit(3);
      if (!requestTraceQuery.error && Array.isArray(requestTraceQuery.data)) {
        for (const row of requestTraceQuery.data) {
          const candidate = readTrace((row as Record<string, unknown>).trace_id);
          if (candidate) traceCandidates.push(candidate);
        }
      }
    }

    resolvedTraceId = traceCandidates[0] ?? null;
  }

  const taskWithResolvedTrace = {
    ...task,
    resolved_trace_id: resolvedTraceId,
  };

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
    const message =
      membershipError instanceof Error ? membershipError.message : String(membershipError ?? '');
    if (code === 'forbidden') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    if (/canvas not found/i.test(message)) {
      // Compatibility fallback: ephemeral/local canvases can enqueue tasks before
      // a canonical `canvases` row exists. Treat room-scoped polling as authorized.
      return NextResponse.json({
        ok: true,
        task: toTaskPayload(taskWithResolvedTrace),
      });
    }
    return NextResponse.json(
      {
        error: message || 'membership check failed',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    task: toTaskPayload(taskWithResolvedTrace),
  });
}
