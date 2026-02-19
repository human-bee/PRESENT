import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminSignedInUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';

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

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminSignedInUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const searchParams = req.nextUrl.searchParams;
  const room = readOptional(searchParams, 'room');
  const task = readOptional(searchParams, 'task');
  const status = readOptional(searchParams, 'status');
  const traceId = readOptional(searchParams, 'traceId');
  const from = readOptional(searchParams, 'from');
  const to = readOptional(searchParams, 'to');
  const limit = parseLimit(searchParams);

  try {
    const db = getAdminSupabaseClient();
    let query = db
      .from('agent_trace_events')
      .select('id,trace_id,request_id,intent_id,room,task_id,task,stage,status,latency_ms,created_at,payload')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (room) query = query.eq('room', room);
    if (task) query = query.eq('task', task);
    if (status) query = query.eq('status', status);
    if (traceId) query = query.eq('trace_id', traceId);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      traces: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to search traces' },
      { status: 500 },
    );
  }
}
