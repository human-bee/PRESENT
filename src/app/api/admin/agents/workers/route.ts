import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';

export const runtime = 'nodejs';

type WorkerHealth = 'online' | 'degraded' | 'offline';

const resolveHealth = (updatedAt: string): WorkerHealth => {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'offline';
  if (ageMs <= 10_000) return 'online';
  if (ageMs <= 30_000) return 'degraded';
  return 'offline';
};

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const db = getAdminSupabaseClient();
    const { data, error } = await db
      .from('agent_worker_heartbeats')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error && isMissingRelationError(error, 'agent_worker_heartbeats')) {
      return NextResponse.json({
        ok: true,
        actorUserId: admin.userId,
        workers: [],
      });
    }
    if (error) throw error;

    const workers = (data ?? []).map((worker: Record<string, unknown>) => ({
      ...worker,
      health:
        typeof worker.updated_at === 'string' && worker.updated_at
          ? resolveHealth(worker.updated_at)
          : 'offline',
    }));

    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      workers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load workers' },
      { status: 500 },
    );
  }
}
