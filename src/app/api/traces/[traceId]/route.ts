import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';
import { buildTaskBackedTraceRows, type AgentTaskTraceSourceRow } from '@/lib/agents/admin/trace-fallback';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ traceId: string }> },
) {
  const admin = await requireAgentAdminUserId(req);
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
      .select('*')
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
      return NextResponse.json({
        traceId: normalizedTraceId,
        events: fallbackEvents,
      });
    }
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      traceId: normalizedTraceId,
      events: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load trace' },
      { status: 500 },
    );
  }
}
