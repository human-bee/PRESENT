import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminSignedInUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingColumnError, isMissingRelationError } from '@/lib/agents/admin/supabase-errors';
import { extractFailureReason, extractWorkerIdentity } from '@/lib/agents/admin/trace-diagnostics';

export const runtime = 'nodejs';

const readOptional = (searchParams: URLSearchParams, key: string): string | undefined => {
  const value = searchParams.get(key);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseLimit = (searchParams: URLSearchParams): number => {
  const raw = searchParams.get('limit');
  if (!raw) return 100;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(250, Math.floor(parsed)));
};

type AgentTaskRow = {
  id: string;
  room: string | null;
  task: string | null;
  status: string | null;
  priority: number | null;
  attempt: number | null;
  error: string | null;
  request_id: string | null;
  trace_id?: string | null;
  resource_keys: string[] | null;
  lease_expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TraceMetaRow = {
  task_id: string | null;
  stage: string | null;
  status: string | null;
  created_at: string | null;
  payload: Record<string, unknown> | null;
};

type QueueTaskWithDiagnostics = AgentTaskRow & {
  worker_id: string | null;
  last_failure_stage: string | null;
  last_failure_reason: string | null;
  last_failure_at: string | null;
};

const TASK_SELECT_WITH_TRACE_ID =
  'id,room,task,status,priority,attempt,error,request_id,trace_id,resource_keys,lease_expires_at,created_at,updated_at';
const TASK_SELECT_COMPAT =
  'id,room,task,status,priority,attempt,error,request_id,resource_keys,lease_expires_at,created_at,updated_at';
const TRACE_META_SELECT = 'task_id,stage,status,created_at,payload';

const normalizeTask = (row: AgentTaskRow): AgentTaskRow => ({
  ...row,
  room: typeof row.room === 'string' ? row.room : null,
  task: typeof row.task === 'string' ? row.task : null,
  status: typeof row.status === 'string' ? row.status : null,
  priority: typeof row.priority === 'number' && Number.isFinite(row.priority) ? row.priority : 0,
  attempt: typeof row.attempt === 'number' && Number.isFinite(row.attempt) ? row.attempt : 0,
  error: typeof row.error === 'string' ? row.error : null,
  request_id: typeof row.request_id === 'string' ? row.request_id : null,
  trace_id: typeof row.trace_id === 'string' ? row.trace_id : null,
  resource_keys: Array.isArray(row.resource_keys) ? row.resource_keys : [],
  lease_expires_at: typeof row.lease_expires_at === 'string' ? row.lease_expires_at : null,
  created_at: typeof row.created_at === 'string' ? row.created_at : null,
  updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
});

const enrichWithTraceDiagnostics = async (
  db: ReturnType<typeof getAdminSupabaseClient>,
  tasks: AgentTaskRow[],
): Promise<QueueTaskWithDiagnostics[]> => {
  const normalizedTasks = tasks.map(normalizeTask);
  if (normalizedTasks.length === 0) {
    return [];
  }

  const taskIds = normalizedTasks.map((task) => task.id);
  const traceLimit = Math.max(250, Math.min(4_000, taskIds.length * 8));
  const { data: traceRows, error: traceError } = await db
    .from('agent_trace_events')
    .select(TRACE_META_SELECT)
    .in('task_id', taskIds)
    .order('created_at', { ascending: false })
    .limit(traceLimit);

  if (traceError && !isMissingRelationError(traceError, 'agent_trace_events')) {
    throw traceError;
  }

  const latestByTaskId = new Map<string, TraceMetaRow>();
  const failureByTaskId = new Map<string, TraceMetaRow>();
  if (Array.isArray(traceRows)) {
    for (const row of traceRows as TraceMetaRow[]) {
      const taskId = typeof row.task_id === 'string' ? row.task_id : null;
      if (!taskId) continue;
      if (!latestByTaskId.has(taskId)) {
        latestByTaskId.set(taskId, row);
      }
      const normalizedStage = typeof row.stage === 'string' ? row.stage.toLowerCase() : null;
      const normalizedStatus = typeof row.status === 'string' ? row.status.toLowerCase() : null;
      const isFailureEvent =
        normalizedStage === 'failed' ||
        normalizedStatus === 'failed' ||
        normalizedStatus === 'error' ||
        normalizedStatus === 'fallback_error' ||
        normalizedStatus === 'queue_error';
      if (isFailureEvent && !failureByTaskId.has(taskId)) {
        failureByTaskId.set(taskId, row);
      }
    }
  }

  return normalizedTasks.map((task) => {
    const latest = latestByTaskId.get(task.id) ?? null;
    const latestWorker = latest ? extractWorkerIdentity(latest.payload) : { workerId: null };
    const failure = failureByTaskId.get(task.id) ?? null;
    const fallbackFailureReason = task.error ?? null;
    const failureReason = failure
      ? extractFailureReason(failure.payload, fallbackFailureReason)
      : fallbackFailureReason;
    const failureStage =
      (failure && typeof failure.stage === 'string' ? failure.stage : null) ??
      (task.status?.toLowerCase() === 'failed' ? 'task_status_fallback' : null);
    const failureAt =
      (failure && typeof failure.created_at === 'string' ? failure.created_at : null) ??
      (task.status?.toLowerCase() === 'failed' ? task.updated_at ?? task.created_at : null);

    return {
      ...task,
      worker_id: latestWorker.workerId,
      last_failure_stage: failureStage,
      last_failure_reason: failureReason,
      last_failure_at: failureAt,
    };
  });
};

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminSignedInUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const searchParams = req.nextUrl.searchParams;
  const room = readOptional(searchParams, 'room');
  const status = readOptional(searchParams, 'status');
  const task = readOptional(searchParams, 'task');
  const limit = parseLimit(searchParams);

  try {
    const db = getAdminSupabaseClient();
    const buildQuery = (selectColumns: string) => {
      let query = db
        .from('agent_tasks')
        .select(selectColumns)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (room) query = query.eq('room', room);
      if (status) query = query.eq('status', status);
      if (task) query = query.eq('task', task);
      return query;
    };

    const withTrace = await buildQuery(TASK_SELECT_WITH_TRACE_ID);
    if (withTrace.error && isMissingColumnError(withTrace.error, 'trace_id')) {
      const compat = await buildQuery(TASK_SELECT_COMPAT);
      if (compat.error) throw compat.error;
      const compatTasks = Array.isArray(compat.data)
        ? compat.data.map((row) => {
          const base =
            row && typeof row === 'object' && !Array.isArray(row)
              ? (row as Record<string, unknown>)
              : {};
            return { ...base, trace_id: null } as AgentTaskRow;
          })
        : [];
      const enrichedCompatTasks = await enrichWithTraceDiagnostics(db, compatTasks);
      return NextResponse.json({
        ok: true,
        actorUserId: admin.userId,
        tasks: enrichedCompatTasks,
      });
    }
    if (withTrace.error) throw withTrace.error;

    const enrichedTasks = await enrichWithTraceDiagnostics(db, (withTrace.data ?? []) as AgentTaskRow[]);

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      tasks: enrichedTasks,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load queue' },
      { status: 500 },
    );
  }
}
