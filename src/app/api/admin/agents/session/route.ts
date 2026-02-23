import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import {
  assignmentToDiagnostics,
  readExperimentAssignmentFromUnknown,
} from '@/lib/agents/shared/experiment-assignment';

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
  experimentVariantCounts: Record<string, number>;
};

const countBy = (values: Array<string | null | undefined>) =>
  values.reduce<Record<string, number>>((acc, value) => {
    const key = value && value.trim().length > 0 ? value.trim() : 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const extractExperiment = (source: unknown) =>
  assignmentToDiagnostics(
    readExperimentAssignmentFromUnknown(source) ??
    readExperimentAssignmentFromUnknown(
      source && typeof source === 'object' && !Array.isArray(source)
        ? (source as Record<string, unknown>).metadata
        : null,
    ),
  );

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
      'id,room,task,status,priority,attempt,error,request_id,trace_id,params,resource_keys,lease_expires_at,created_at,updated_at';
    const queueSelectCompat =
      'id,room,task,status,priority,attempt,error,request_id,params,resource_keys,lease_expires_at,created_at,updated_at';

    const queueWithTrace = await db
      .from('agent_tasks')
      .select(queueSelectWithTrace)
      .eq('room', room)
      .order('created_at', { ascending: false })
      .limit(limit);

    let tasks: Array<Record<string, unknown>> = [];
    if (
      queueWithTrace.error &&
      (/trace_id/i.test(queueWithTrace.error.message) || /params/i.test(queueWithTrace.error.message))
    ) {
      const queueCompat = await db
        .from('agent_tasks')
        .select(queueSelectCompat)
        .eq('room', room)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (queueCompat.error && /params/i.test(queueCompat.error.message)) {
        const queueLegacy = await db
          .from('agent_tasks')
          .select(
            'id,room,task,status,priority,attempt,error,request_id,resource_keys,lease_expires_at,created_at,updated_at',
          )
          .eq('room', room)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (queueLegacy.error) throw queueLegacy.error;
        tasks = (queueLegacy.data ?? []).map((row) => ({
          ...(row as Record<string, unknown>),
          trace_id: null,
          params: null,
        }));
      } else {
        if (queueCompat.error) throw queueCompat.error;
        tasks = (queueCompat.data ?? []).map((row) => ({
          ...(row as Record<string, unknown>),
          trace_id: null,
        }));
      }
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

    const readId = (value: unknown): string | null =>
      typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

    const traceIdsByRequest = new Map<string, string>();
    const traceIdsByTask = new Map<string, string>();
    for (const trace of traces) {
      const traceId = readId(trace.trace_id);
      if (!traceId) continue;
      const requestId = readId(trace.request_id);
      const taskId = readId(trace.task_id);
      if (requestId && !traceIdsByRequest.has(requestId)) {
        traceIdsByRequest.set(requestId, traceId);
      }
      if (taskId && !traceIdsByTask.has(taskId)) {
        traceIdsByTask.set(taskId, traceId);
      }
    }

    const tasksWithResolvedTrace: Array<
      Record<string, unknown> & {
        trace_id: string | null;
        resolved_trace_id: string | null;
        trace_integrity: 'direct' | 'resolved_from_events' | 'missing';
        experiment?: ReturnType<typeof assignmentToDiagnostics>;
      }
    > = tasks.map((task) => {
      const traceId = readId(task.trace_id);
      const requestId = readId(task.request_id);
      const taskId = readId(task.id);
      const resolvedTraceId =
        traceId ??
        (taskId ? traceIdsByTask.get(taskId) ?? null : null) ??
        (requestId ? traceIdsByRequest.get(requestId) ?? null : null);
      const experiment = extractExperiment(task.params);
      return {
        ...task,
        trace_id: traceId,
        resolved_trace_id: resolvedTraceId,
        trace_integrity: traceId
          ? 'direct'
          : resolvedTraceId
            ? 'resolved_from_events'
            : 'missing',
        ...(experiment ? { experiment } : {}),
      };
    });

    const traceIds = new Set<string>();
    const requestIds = new Set<string>();
    for (const task of tasksWithResolvedTrace) {
      const traceId = readId(task.resolved_trace_id) ?? readId(task.trace_id) ?? '';
      const requestId = readId((task as Record<string, unknown>)['request_id']) ?? '';
      if (traceId) traceIds.add(traceId);
      if (requestId) requestIds.add(requestId);
    }
    for (const trace of traces) {
      const traceId = readId(trace.trace_id) ?? '';
      const requestId = readId(trace.request_id) ?? '';
      if (traceId) traceIds.add(traceId);
      if (requestId) requestIds.add(requestId);
    }

    const summary: CorrelationSummary = {
      tasksTotal: tasks.length,
      tracesTotal: traces.length,
      uniqueTraceIds: traceIds.size,
      uniqueRequestIds: requestIds.size,
      taskStatusCounts: countBy(
        tasksWithResolvedTrace.map((task) =>
          typeof (task as Record<string, unknown>)['status'] === 'string'
            ? ((task as Record<string, unknown>)['status'] as string)
            : null,
        ),
      ),
      traceStageCounts: countBy(traces.map((trace) => (typeof trace.stage === 'string' ? trace.stage : null))),
      missingTraceOnTasks: tasksWithResolvedTrace.filter((task) => {
        const traceId =
          typeof task.resolved_trace_id === 'string' && task.resolved_trace_id.trim().length > 0
            ? task.resolved_trace_id.trim()
            : '';
        return traceId.length === 0;
      }).length,
      experimentVariantCounts: countBy(
        tasksWithResolvedTrace.map((task) =>
          task.experiment && typeof task.experiment.variantId === 'string'
            ? task.experiment.variantId
            : null,
        ),
      ),
    };

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      room,
      limit,
      summary,
      tasks: tasksWithResolvedTrace,
      traces,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load session observability' },
      { status: 500 },
    );
  }
}
