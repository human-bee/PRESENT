import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';

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
    if (traceCountError) throw traceCountError;

    const { data: workers, error: workersError } = await db
      .from('agent_worker_heartbeats')
      .select('worker_id,updated_at,active_tasks,queue_lag_ms,host,pid,version')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (workersError) throw workersError;

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      queue: statusCounts,
      tracesLastHour: recentTraceCount ?? 0,
      workers: workers ?? [],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load overview' },
      { status: 500 },
    );
  }
}
