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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traceId: string }> },
) {
  const admin = await requireAgentAdminSignedInUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const { traceId } = await params;
  const normalizedTraceId = traceId.trim();
  if (!normalizedTraceId) {
    return NextResponse.json({ error: 'traceId required' }, { status: 400 });
  }

  try {
    const db = getAdminSupabaseClient();
    const { data, error } = await db
      .from('agent_trace_events')
      .select(TRACE_SELECT_COLUMNS)
      .eq('trace_id', normalizedTraceId)
      .order('created_at', { ascending: true })
      .limit(2_000);
    if (error && isMissingRelationError(error, 'agent_trace_events')) {
      const { data: taskData, error: taskError } = await db
        .from('agent_tasks')
        .select('id,room,task,status,attempt,error,request_id,params,created_at,updated_at')
        .order('updated_at', { ascending: true })
        .limit(2_000);
      if (taskError) {
        return NextResponse.json({ error: taskError.message }, { status: 500 });
      }
      const fallbackEvents = buildTaskBackedTraceRows((taskData ?? []) as AgentTaskTraceSourceRow[], {
        order: 'asc',
      }).filter((row) => row.trace_id === normalizedTraceId);
      const enrichedFallbackEvents = fallbackEvents.map((row) => ({
        ...row,
        subsystem: classifyTraceSubsystem(row.stage),
        worker_id: null,
        worker_host: null,
        worker_pid: null,
        failure_reason: extractFailureReason(row.payload),
      }));
      return NextResponse.json({
        traceId: normalizedTraceId,
        events: enrichedFallbackEvents,
      });
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const enrichedEvents = (data ?? []).map((row) => {
      const payload =
        row && typeof row === 'object' && !Array.isArray(row)
          ? (row as Record<string, unknown>).payload
          : null;
      const worker = extractWorkerIdentity(payload);
      const stage =
        row && typeof row === 'object' && !Array.isArray(row)
          ? (row as Record<string, unknown>).stage
          : null;
      const status =
        row && typeof row === 'object' && !Array.isArray(row)
          ? (row as Record<string, unknown>).status
          : null;
      return {
        ...(row as Record<string, unknown>),
        subsystem: classifyTraceSubsystem(typeof stage === 'string' ? stage : null),
        worker_id: worker.workerId,
        worker_host: worker.workerHost,
        worker_pid: worker.workerPid,
        failure_reason: extractFailureReason(payload, typeof status === 'string' ? status : null),
      };
    });

    return NextResponse.json({
      traceId: normalizedTraceId,
      events: enrichedEvents,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load trace' },
      { status: 500 },
    );
  }
}
