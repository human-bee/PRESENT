import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const db = getAdminSupabaseClient();
    const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const queueStatuses = ['queued', 'running', 'failed', 'succeeded', 'canceled'] as const;

    const statusCounts: Record<string, number> = {};
    for (const status of queueStatuses) {
      const { count, error } = await db
        .from('agent_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw error;
      statusCounts[status] = count ?? 0;
    }

    const { count: recentTraceCount, error: traceCountError } = await db
      .from('agent_trace_events')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso);
    let tracesLastHour = recentTraceCount ?? 0;
    if (traceCountError && isMissingRelationError(traceCountError, 'agent_trace_events')) {
      const { count: fallbackTraceCount, error: fallbackTraceError } = await db
        .from('agent_tasks')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso);
      if (fallbackTraceError) throw fallbackTraceError;
      tracesLastHour = fallbackTraceCount ?? 0;
    } else if (traceCountError) {
      throw traceCountError;
    }

    const { data: workers, error: workersError } = await db
      .from('agent_worker_heartbeats')
      .select('worker_id,updated_at,active_tasks,queue_lag_ms,host,pid,version')
      .order('updated_at', { ascending: false })
      .limit(50);
    const normalizedWorkers =
      workersError && isMissingRelationError(workersError, 'agent_worker_heartbeats') ? [] : workers;
    if (workersError && !isMissingRelationError(workersError, 'agent_worker_heartbeats')) throw workersError;

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      actorAccessMode: admin.mode,
      safeActionsAllowed: admin.mode === 'allowlist',
      queue: statusCounts,
      tracesLastHour,
      workers: normalizedWorkers ?? [],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load overview' },
      { status: 500 },
    );
  }
}
