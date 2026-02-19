import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminSignedInUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingColumnError, isMissingRelationError } from '@/lib/agents/admin/supabase-errors';
import {
  extractFailureReason,
  extractProviderIdentity,
  extractWorkerIdentity,
} from '@/lib/agents/admin/trace-diagnostics';
import { normalizeProvider, normalizeProviderPath } from '@/lib/agents/admin/provider-parity';

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

const MAX_PROVIDER_FILTER_SCAN = 5_000;
const MAX_TRACE_DIAGNOSTIC_ROWS = 50_000;
const PROVIDER_PARITY_COLUMNS = [
  'provider',
  'model',
  'provider_source',
  'provider_path',
  'provider_request_id',
] as const;

const isMissingProviderParityColumnError = (error: unknown): boolean =>
  PROVIDER_PARITY_COLUMNS.some((column) => isMissingColumnError(error, column));

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
  params?: Record<string, unknown> | null;
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
  trace_id?: string | null;
  request_id?: string | null;
  room?: string | null;
  task?: string | null;
  provider?: string | null;
  model?: string | null;
  provider_source?: string | null;
  provider_path?: string | null;
  provider_request_id?: string | null;
  payload: Record<string, unknown> | null;
};

type QueueTaskWithDiagnostics = AgentTaskRow & {
  worker_id: string | null;
  last_failure_stage: string | null;
  last_failure_reason: string | null;
  last_failure_at: string | null;
  provider: string;
  model: string | null;
  provider_source: string;
  provider_path: string;
  provider_request_id: string | null;
  provider_context_url: string | null;
};

const TASK_SELECT_BASE_COLUMNS = [
  'id',
  'room',
  'task',
  'status',
  'priority',
  'attempt',
  'error',
  'request_id',
  'resource_keys',
  'lease_expires_at',
  'created_at',
  'updated_at',
];
const buildTaskSelectColumns = (options: {
  includeTraceId: boolean;
  includeParams: boolean;
}): string =>
  [
    ...TASK_SELECT_BASE_COLUMNS,
    ...(options.includeTraceId ? ['trace_id'] : []),
    ...(options.includeParams ? ['params'] : []),
  ].join(',');
const TRACE_META_SELECT = [
  'task_id',
  'trace_id',
  'request_id',
  'room',
  'task',
  'stage',
  'status',
  'provider',
  'model',
  'provider_source',
  'provider_path',
  'provider_request_id',
  'created_at',
  'payload',
].join(',');
const TRACE_META_SELECT_COMPAT = 'task_id,trace_id,request_id,room,task,stage,status,created_at,payload';

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
  params:
    row.params && typeof row.params === 'object' && !Array.isArray(row.params)
      ? (row.params as Record<string, unknown>)
      : null,
  resource_keys: Array.isArray(row.resource_keys) ? row.resource_keys : [],
  lease_expires_at: typeof row.lease_expires_at === 'string' ? row.lease_expires_at : null,
  created_at: typeof row.created_at === 'string' ? row.created_at : null,
  updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
});

const enrichWithTraceDiagnostics = async (
  db: ReturnType<typeof getAdminSupabaseClient>,
  tasks: AgentTaskRow[],
  traceIdFilter?: string,
): Promise<QueueTaskWithDiagnostics[]> => {
  const normalizedTasks = tasks.map(normalizeTask);
  if (normalizedTasks.length === 0) {
    return [];
  }

  const taskIds = normalizedTasks.map((task) => task.id);
  const traceLimit = Math.max(500, Math.min(MAX_TRACE_DIAGNOSTIC_ROWS, taskIds.length * 12));
  const primaryTraceQuery = await db
    .from('agent_trace_events')
    .select(TRACE_META_SELECT)
    .in('task_id', taskIds)
    .order('created_at', { ascending: false })
    .limit(traceLimit);
  let traceRows: TraceMetaRow[] | null = Array.isArray(primaryTraceQuery.data)
    ? (primaryTraceQuery.data as unknown as TraceMetaRow[])
    : null;
  let traceError: unknown = primaryTraceQuery.error;
  if (traceError && isMissingProviderParityColumnError(traceError)) {
    const compat = await db
      .from('agent_trace_events')
      .select(TRACE_META_SELECT_COMPAT)
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
      .limit(traceLimit);
    traceRows = Array.isArray(compat.data) ? (compat.data as unknown as TraceMetaRow[]) : null;
    traceError = compat.error;
  }

  if (traceError && !isMissingRelationError(traceError, 'agent_trace_events')) {
    throw traceError;
  }

  const latestByTaskId = new Map<string, TraceMetaRow>();
  const failureByTaskId = new Map<string, TraceMetaRow>();
  const successByTaskId = new Map<string, TraceMetaRow>();
  const traceIdByTaskId = new Map<string, string>();
  const toMillis = (value: string | null | undefined): number => {
    if (!value) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  if (Array.isArray(traceRows)) {
    for (const row of traceRows as TraceMetaRow[]) {
      const taskId = typeof row.task_id === 'string' ? row.task_id : null;
      if (!taskId) continue;
      if (!traceIdByTaskId.has(taskId) && typeof row.trace_id === 'string' && row.trace_id.trim().length > 0) {
        traceIdByTaskId.set(taskId, row.trace_id.trim());
      }
      if (!latestByTaskId.has(taskId)) {
        latestByTaskId.set(taskId, row);
      }
      const normalizedStage = typeof row.stage === 'string' ? row.stage.toLowerCase() : null;
      const normalizedStatus = typeof row.status === 'string' ? row.status.toLowerCase() : null;
      const isSuccessEvent =
        normalizedStage === 'completed' ||
        normalizedStatus === 'succeeded' ||
        normalizedStatus === 'ok' ||
        normalizedStatus === 'completed';
      if (isSuccessEvent && !successByTaskId.has(taskId)) {
        successByTaskId.set(taskId, row);
      }
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
    const fallbackTraceId = traceIdByTaskId.get(task.id) ?? null;
    const latestWorker = latest ? extractWorkerIdentity(latest.payload) : { workerId: null };
    const latestFailure = failureByTaskId.get(task.id) ?? null;
    const latestSuccess = successByTaskId.get(task.id) ?? null;
    const taskSucceeded = task.status?.toLowerCase() === 'succeeded';
    const failure =
      latestFailure &&
      taskSucceeded &&
      latestSuccess &&
      toMillis(latestFailure.created_at) <= toMillis(latestSuccess.created_at)
        ? null
        : latestFailure;
    const fallbackFailureReason = taskSucceeded ? null : task.error ?? null;
    const failureReason = failure
      ? extractFailureReason(failure.payload, fallbackFailureReason)
      : fallbackFailureReason;
    const failureStage =
      (failure && typeof failure.stage === 'string' ? failure.stage : null) ??
      (task.status?.toLowerCase() === 'failed' ? 'task_status_fallback' : null);
    const failureAt =
      (failure && typeof failure.created_at === 'string' ? failure.created_at : null) ??
      (task.status?.toLowerCase() === 'failed' ? task.updated_at ?? task.created_at : null);

    const providerIdentity = latest
      ? extractProviderIdentity({
        ...latest,
        params: task.params ?? undefined,
      })
      : extractProviderIdentity({
        task: task.task,
        status: task.status,
        room: task.room,
        task_id: task.id,
        request_id: task.request_id,
        trace_id: task.trace_id ?? undefined,
        params: task.params ?? undefined,
        payload: { error: task.error },
      });

    const { params: _params, ...taskPublicFields } = task;
    return {
      ...taskPublicFields,
      trace_id: task.trace_id ?? fallbackTraceId,
      worker_id: latestWorker.workerId,
      last_failure_stage: failureStage,
      last_failure_reason: failureReason,
      last_failure_at: failureAt,
      provider: providerIdentity.provider,
      model: providerIdentity.model,
      provider_source: providerIdentity.providerSource,
      provider_path: providerIdentity.providerPath,
      provider_request_id: providerIdentity.providerRequestId,
      provider_context_url: providerIdentity.providerContextUrl,
    };
  }).filter((task) => (traceIdFilter ? task.trace_id === traceIdFilter : true));
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
  const traceId = readOptional(searchParams, 'traceId');
  const provider = readOptional(searchParams, 'provider');
  const providerPath = readOptional(searchParams, 'providerPath');
  const limit = parseLimit(searchParams);
  const normalizedProvider = provider ? normalizeProvider(provider) : undefined;
  const normalizedProviderPath = providerPath ? normalizeProviderPath(providerPath) : undefined;
  const queryLimit =
    normalizedProvider || normalizedProviderPath
      ? Math.max(limit, Math.min(1_000, limit * 4))
      : limit;

  try {
    const db = getAdminSupabaseClient();
    const buildQuery = (selectColumns: string, rowLimit: number) => {
      let query = db
        .from('agent_tasks')
        .select(selectColumns)
        .order('created_at', { ascending: false })
        .limit(rowLimit);
      if (room) query = query.eq('room', room);
      if (status) query = query.eq('status', status);
      if (task) query = query.eq('task', task);
      if (traceId && selectColumns.includes('trace_id')) query = query.eq('trace_id', traceId);
      return query;
    };

    let includeTraceId = true;
    let includeParams = true;
    let fetchLimit = queryLimit;

    while (true) {
      let taskRows: AgentTaskRow[] = [];
      while (true) {
        const columns = buildTaskSelectColumns({ includeTraceId, includeParams });
        const queryResult = await buildQuery(columns, fetchLimit);
        if (!queryResult.error) {
          taskRows = Array.isArray(queryResult.data)
            ? queryResult.data.map((row) => {
                const base =
                  row && typeof row === 'object' && !Array.isArray(row)
                    ? (row as Record<string, unknown>)
                    : {};
                return {
                  ...base,
                  trace_id:
                    includeTraceId && typeof base.trace_id === 'string' ? base.trace_id : null,
                  params:
                    includeParams &&
                    base.params &&
                    typeof base.params === 'object' &&
                    !Array.isArray(base.params)
                      ? (base.params as Record<string, unknown>)
                      : null,
                } as AgentTaskRow;
              })
            : [];
          break;
        }

        if (isMissingColumnError(queryResult.error, 'trace_id') && includeTraceId) {
          includeTraceId = false;
          continue;
        }
        if (isMissingColumnError(queryResult.error, 'params') && includeParams) {
          includeParams = false;
          continue;
        }
        throw queryResult.error;
      }

      const enrichedTasks = await enrichWithTraceDiagnostics(db, taskRows, traceId);
      const filteredTasks = enrichedTasks
        .filter((item) => (normalizedProvider ? item.provider === normalizedProvider : true))
        .filter((item) => (normalizedProviderPath ? item.provider_path === normalizedProviderPath : true))
        .slice(0, limit);

      const shouldExpandScan =
        Boolean(normalizedProvider || normalizedProviderPath) &&
        filteredTasks.length < limit &&
        taskRows.length >= fetchLimit &&
        fetchLimit < MAX_PROVIDER_FILTER_SCAN;
      if (!shouldExpandScan) {
        return NextResponse.json({
          ok: true,
          actorUserId: admin.userId,
          tasks: filteredTasks,
        });
      }

      fetchLimit = Math.min(MAX_PROVIDER_FILTER_SCAN, fetchLimit * 2);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load queue' },
      { status: 500 },
    );
  }
}
