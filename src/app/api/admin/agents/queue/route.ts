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
  const room = readOptional(searchParams, 'room');
  const status = readOptional(searchParams, 'status');
  const task = readOptional(searchParams, 'task');
  const limit = parseLimit(searchParams);

  try {
    const db = getAdminSupabaseClient();
    const buildQuery = (selectColumns: string) => {
      let query = db
        .from('agent_tasks')
        .select(selectColumns)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (room) query = query.eq('room', room);
      if (status) query = query.eq('status', status);
      if (task) query = query.eq('task', task);
      return query;
    };

    const selectWithTraceId =
      'id,room,task,status,priority,attempt,error,request_id,trace_id,resource_keys,lease_expires_at,created_at,updated_at';
    const selectCompat =
      'id,room,task,status,priority,attempt,error,request_id,resource_keys,lease_expires_at,created_at,updated_at';

    let { data, error } = await buildQuery(selectWithTraceId);
    if (error && /trace_id/i.test(error.message)) {
      ({ data, error } = await buildQuery(selectCompat));
      if (!error && Array.isArray(data)) {
        data = data.map((row) => {
          const base =
            row && typeof row === 'object' && !Array.isArray(row)
              ? (row as Record<string, unknown>)
              : {};
          return { ...base, trace_id: null };
        });
      }
    }
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      tasks: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load queue' },
      { status: 500 },
    );
  }
}
