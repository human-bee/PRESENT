import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminSignedInUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingColumnError, isMissingRelationError } from '@/lib/agents/admin/supabase-errors';
import { buildTaskBackedTraceRows, type AgentTaskTraceSourceRow } from '@/lib/agents/admin/trace-fallback';
import {
  classifyTraceSubsystem,
  extractProviderIdentity,
  extractFailureReason,
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

const TRACE_SELECT_COLUMNS = [
  'id',
  'trace_id',
  'request_id',
  'intent_id',
  'room',
  'task_id',
  'task',
  'stage',
  'status',
  'provider',
  'model',
  'provider_source',
  'provider_path',
  'provider_request_id',
  'latency_ms',
  'created_at',
  'payload',
].join(',');

const TRACE_SELECT_COLUMNS_COMPAT = [
  'id',
  'trace_id',
  'request_id',
  'intent_id',
  'room',
  'task_id',
  'task',
  'stage',
  'status',
  'latency_ms',
  'created_at',
  'payload',
].join(',');

const MAX_PROVIDER_FILTER_SCAN = 5_000;
const PROVIDER_PARITY_COLUMNS = [
  'provider',
  'model',
  'provider_source',
  'provider_path',
  'provider_request_id',
] as const;

const isMissingProviderParityColumnError = (error: unknown): boolean =>
  PROVIDER_PARITY_COLUMNS.some((column) => isMissingColumnError(error, column));

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminSignedInUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const searchParams = req.nextUrl.searchParams;
  const traceId = readOptional(searchParams, 'traceId');
  const room = readOptional(searchParams, 'room');
  const task = readOptional(searchParams, 'task');
  const stage = readOptional(searchParams, 'stage');
  const status = readOptional(searchParams, 'status');
  const provider = readOptional(searchParams, 'provider');
  const providerPath = readOptional(searchParams, 'providerPath');
  const limit = parseLimit(searchParams);
  const normalizedProvider = provider ? normalizeProvider(provider) : undefined;
  const normalizedProviderPath = providerPath ? normalizeProviderPath(providerPath) : undefined;
  const queryLimit =
    normalizedProvider || normalizedProviderPath
      ? Math.max(limit, Math.min(1_250, limit * 5))
      : limit;
  const normalizedStage = stage?.trim().toLowerCase();

  try {
    const db = getAdminSupabaseClient();
    const buildTraceQuery = (columns: string, rowLimit: number, useProviderFilters: boolean) => {
      let query = db
        .from('agent_trace_events')
        .select(columns)
        .order('created_at', { ascending: false })
        .limit(rowLimit);
      if (traceId) query = query.eq('trace_id', traceId);
      if (room) query = query.eq('room', room);
      if (task) query = query.eq('task', task);
      if (stage) query = query.eq('stage', stage);
      if (status) query = query.eq('status', status);
      if (useProviderFilters && normalizedProvider && normalizedProvider !== 'unknown') {
        query = query.eq('provider', normalizedProvider);
      }
      if (useProviderFilters && normalizedProviderPath && normalizedProviderPath !== 'unknown') {
        query = query.eq('provider_path', normalizedProviderPath);
      }
      return query;
    };
    let useCompatSelect = false;
    let fetchLimit = queryLimit;
    while (true) {
      const selectColumns = useCompatSelect ? TRACE_SELECT_COLUMNS_COMPAT : TRACE_SELECT_COLUMNS;
      const useProviderFilters = !useCompatSelect;
      let { data, error } = await buildTraceQuery(selectColumns, fetchLimit, useProviderFilters);
      if (error && isMissingProviderParityColumnError(error) && !useCompatSelect) {
        useCompatSelect = true;
        continue;
      }
      if (error && isMissingRelationError(error, 'agent_trace_events')) {
        const fallbackLimit = traceId ? 2_000 : fetchLimit;
        let taskQuery = db
          .from('agent_tasks')
          .select('id,room,task,status,attempt,error,request_id,params,created_at,updated_at')
          .order('updated_at', { ascending: false })
          .limit(fallbackLimit);
        if (room) taskQuery = taskQuery.eq('room', room);
        if (task) taskQuery = taskQuery.eq('task', task);
        if (status) taskQuery = taskQuery.eq('status', status);

        const { data: fallbackData, error: fallbackError } = await taskQuery;
        if (fallbackError) throw fallbackError;

        let fallbackTraces = buildTaskBackedTraceRows((fallbackData ?? []) as AgentTaskTraceSourceRow[]);
        if (traceId) fallbackTraces = fallbackTraces.filter((row) => row.trace_id === traceId);
        if (normalizedStage) fallbackTraces = fallbackTraces.filter((row) => row.stage.toLowerCase() === normalizedStage);

        const enrichedFallbackTraces = fallbackTraces.map((row) => ({
          ...row,
          subsystem: classifyTraceSubsystem(row.stage),
          worker_id: null,
          worker_host: null,
          worker_pid: null,
          failure_reason: extractFailureReason(row.payload),
          provider: row.provider,
          model: row.model,
          provider_source: row.provider_source,
          provider_path: row.provider_path,
          provider_request_id: row.provider_request_id,
          provider_context_url: extractProviderIdentity(row).providerContextUrl,
        }));
        const filteredFallbackTraces = enrichedFallbackTraces
          .filter((row) => (normalizedProvider ? row.provider === normalizedProvider : true))
          .filter((row) => (normalizedProviderPath ? row.provider_path === normalizedProviderPath : true))
          .slice(0, limit);

        return NextResponse.json({
          ok: true,
          actorUserId: admin.userId,
          traces: filteredFallbackTraces,
        });
      }
      if (error) throw error;

      const enrichedTraces = (data ?? []).map((row) => {
        const rowRecord =
          row && typeof row === 'object' && !Array.isArray(row)
            ? (row as unknown as Record<string, unknown>)
            : {};
        const payload =
          row && typeof row === 'object' && !Array.isArray(row)
            ? rowRecord.payload
            : null;
        const worker = extractWorkerIdentity(payload);
        const status = rowRecord.status ?? null;
        const stage = rowRecord.stage ?? null;
        const providerIdentity = extractProviderIdentity({
          ...rowRecord,
          payload,
        });
        return {
          ...rowRecord,
          subsystem: classifyTraceSubsystem(typeof stage === 'string' ? stage : null),
          worker_id: worker.workerId,
          worker_host: worker.workerHost,
          worker_pid: worker.workerPid,
          failure_reason: extractFailureReason(payload, typeof status === 'string' ? status : null),
          provider: providerIdentity.provider,
          model: providerIdentity.model,
          provider_source: providerIdentity.providerSource,
          provider_path: providerIdentity.providerPath,
          provider_request_id: providerIdentity.providerRequestId,
          provider_context_url: providerIdentity.providerContextUrl,
        };
      });
      const filteredTraces = enrichedTraces
        .filter((row) => (normalizedProvider ? row.provider === normalizedProvider : true))
        .filter((row) => (normalizedProviderPath ? row.provider_path === normalizedProviderPath : true))
        .slice(0, limit);
      const requiresInMemoryProviderScan =
        useCompatSelect || normalizedProvider === 'unknown' || normalizedProviderPath === 'unknown';
      const shouldExpandScan =
        requiresInMemoryProviderScan &&
        Boolean(normalizedProvider || normalizedProviderPath) &&
        filteredTraces.length < limit &&
        (data ?? []).length >= fetchLimit &&
        fetchLimit < MAX_PROVIDER_FILTER_SCAN;
      if (!shouldExpandScan) {
        return NextResponse.json({
          ok: true,
          actorUserId: admin.userId,
          traces: filteredTraces,
        });
      }

      fetchLimit = Math.min(MAX_PROVIDER_FILTER_SCAN, fetchLimit * 2);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load traces' },
      { status: 500 },
    );
  }
}
