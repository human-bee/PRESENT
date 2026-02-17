import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminSignedInUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';
import { buildTaskBackedTraceRows, type AgentTaskTraceSourceRow } from '@/lib/agents/admin/trace-fallback';
import {
  classifyTraceSubsystem,
  extractFailureReason,
  extractWorkerIdentity,
} from '@/lib/agents/admin/trace-diagnostics';

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
  'latency_ms',
  'created_at',
  'payload',
].join(',');

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
  const limit = parseLimit(searchParams);
  const normalizedStage = stage?.trim().toLowerCase();

  try {
    const db = getAdminSupabaseClient();
    let query = db
      .from('agent_trace_events')
      .select(TRACE_SELECT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (traceId) query = query.eq('trace_id', traceId);
    if (room) query = query.eq('room', room);
    if (task) query = query.eq('task', task);
    if (stage) query = query.eq('stage', stage);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error && isMissingRelationError(error, 'agent_trace_events')) {
      const fallbackLimit = traceId ? 2_000 : limit;
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
      fallbackTraces = fallbackTraces.slice(0, limit);

      const enrichedFallbackTraces = fallbackTraces.map((row) => ({
        ...row,
        subsystem: classifyTraceSubsystem(row.stage),
        worker_id: null,
        worker_host: null,
        worker_pid: null,
        failure_reason: extractFailureReason(row.payload),
      }));

      return NextResponse.json({
        ok: true,
        actorUserId: admin.userId,
        traces: enrichedFallbackTraces,
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
      return {
        ...rowRecord,
        subsystem: classifyTraceSubsystem(typeof stage === 'string' ? stage : null),
        worker_id: worker.workerId,
        worker_host: worker.workerHost,
        worker_pid: worker.workerPid,
        failure_reason: extractFailureReason(payload, typeof status === 'string' ? status : null),
      };
    });

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      traces: enrichedTraces,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load traces' },
      { status: 500 },
    );
  }
}
