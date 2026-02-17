import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminSignedInUserId } from '@/lib/agents/admin/auth';
import { getAdminSupabaseClient } from '@/lib/agents/admin/supabase-admin';
import { isMissingRelationError } from '@/lib/agents/admin/supabase-errors';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminSignedInUserId(req);
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
    if (error && isMissingRelationError(error, 'agent_ops_audit_log')) {
      return NextResponse.json({
        ok: true,
        actorUserId: admin.userId,
        entries: [],
      });
    }
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
