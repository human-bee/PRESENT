import { NextRequest, NextResponse } from 'next/server';
import { requireAgentAdminUserId } from '@/lib/agents/admin/auth';
import { loadBenchmarkManifest } from '@/app/admin/agents/benchmarks/benchmark-data';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAgentAdminUserId(req);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const manifest = await loadBenchmarkManifest();
    return NextResponse.json({ manifest }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
