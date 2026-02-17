import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';

export const runtime = 'nodejs';

const readOptional = (searchParams: URLSearchParams, key: string): string | undefined => {
  const value = searchParams.get(key);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseLimit = (searchParams: URLSearchParams): number => {
  const raw = searchParams.get('limit');
  if (!raw) return 200;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 200;
  return Math.max(1, Math.min(500, Math.floor(parsed)));
};

const deriveRoom = (searchParams: URLSearchParams): string | undefined => {
  const room = readOptional(searchParams, 'room');
  if (room) return room;
  const canvasId = readOptional(searchParams, 'canvasId');
  if (!canvasId) return undefined;
  return canvasId.startsWith('canvas-') ? canvasId : `canvas-${canvasId}`;
};

type CorrelationSummary = {
  tasksTotal: number;
  tracesTotal: number;
  uniqueTraceIds: number;
  uniqueRequestIds: number;
  taskStatusCounts: Record<string, number>;
  traceStageCounts: Record<string, number>;
  missingTraceOnTasks: number;
};

const countBy = (values: Array<string | null | undefined>) =>
  values.reduce<Record<string, number>>((acc, value) => {
    const key = value && value.trim().length > 0 ? value.trim() : 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const room = deriveRoom(req.nextUrl.searchParams);
  if (!room) {
    return NextResponse.json({ error: 'room or canvasId is required' }, { status: 400 });
  }
  const limit = parseLimit(req.nextUrl.searchParams);

  try {
    const db = getAdminSupabaseClient();

    const queueSelectWithTrace =
      'id,room,task,status,priority,attempt,error,request_id,trace_id,resource_keys,lease_expires_at,created_at,updated_at';
    const queueSelectCompat =
      'id,room,task,status,priority,attempt,error,request_id,resource_keys,lease_expires_at,created_at,updated_at';

    const queueWithTrace = await db
      .from('agent_tasks')
      .select(queueSelectWithTrace)
      .eq('room', room)
      .order('created_at', { ascending: false })
      .limit(limit);

    let tasks: Array<Record<string, unknown>> = [];
    if (queueWithTrace.error && /trace_id/i.test(queueWithTrace.error.message)) {
      const queueCompat = await db
        .from('agent_tasks')
        .select(queueSelectCompat)
        .eq('room', room)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (queueCompat.error) throw queueCompat.error;
      tasks = (queueCompat.data ?? []).map((row) => ({ ...(row as Record<string, unknown>), trace_id: null }));
    } else if (queueWithTrace.error) {
      throw queueWithTrace.error;
    } else {
      tasks = (queueWithTrace.data ?? []) as Array<Record<string, unknown>>;
    }

    const tracesQuery = await db
      .from('agent_trace_events')
      .select('*')
      .eq('room', room)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (tracesQuery.error) throw tracesQuery.error;
    const traces = (tracesQuery.data ?? []) as Array<Record<string, unknown>>;

    const traceIds = new Set<string>();
    const requestIds = new Set<string>();
    for (const task of tasks) {
      const traceId = typeof task.trace_id === 'string' ? task.trace_id.trim() : '';
      const requestId = typeof task.request_id === 'string' ? task.request_id.trim() : '';
      if (traceId) traceIds.add(traceId);
      if (requestId) requestIds.add(requestId);
    }
    for (const trace of traces) {
      const traceId = typeof trace.trace_id === 'string' ? trace.trace_id.trim() : '';
      const requestId = typeof trace.request_id === 'string' ? trace.request_id.trim() : '';
      if (traceId) traceIds.add(traceId);
      if (requestId) requestIds.add(requestId);
    }

    const summary: CorrelationSummary = {
      tasksTotal: tasks.length,
      tracesTotal: traces.length,
      uniqueTraceIds: traceIds.size,
      uniqueRequestIds: requestIds.size,
      taskStatusCounts: countBy(tasks.map((task) => (typeof task.status === 'string' ? task.status : null))),
      traceStageCounts: countBy(traces.map((trace) => (typeof trace.stage === 'string' ? trace.stage : null))),
      missingTraceOnTasks: tasks.filter((task) => {
        const traceId = typeof task.trace_id === 'string' ? task.trace_id.trim() : '';
        return traceId.length === 0;
      }).length,
    };

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      room,
      limit,
      summary,
      tasks,
      traces,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load session observability' },
      { status: 500 },
    );
  }
}

