import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';
import { buildTaskBackedTraceRows, type AgentTaskTraceSourceRow } from '@/lib/agents/admin/trace-fallback';

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

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminUserId(req);
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
    let query = db.from('agent_trace_events').select('*').order('created_at', { ascending: false }).limit(limit);
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

      return NextResponse.json({
        ok: true,
        actorUserId: admin.userId,
        traces: fallbackTraces,
      });
    }
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      traces: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load traces' },
      { status: 500 },
    );
  }
}
