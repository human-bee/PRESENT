import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? 100);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 100));

  try {
    const db = getAdminSupabaseClient();
    const { data, error } = await db
      .from('agent_ops_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      actorUserId: admin.userId,
      entries: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed to load audit log' },
      { status: 500 },
    );
  }
}
