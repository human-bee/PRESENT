import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';

export const runtime = 'nodejs';

const readOptional = (searchParams: URLSearchParams, key: string): string | undefined => {
  const value = searchParams.get(key);
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
  const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') ?? 200)));

  try {
    const db = getAdminSupabaseClient();
    let query = db.from('agent_trace_events').select('*').order('created_at', { ascending: false }).limit(limit);
    if (traceId) query = query.eq('trace_id', traceId);
    if (room) query = query.eq('room', room);
    if (task) query = query.eq('task', task);
    if (stage) query = query.eq('stage', stage);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
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
