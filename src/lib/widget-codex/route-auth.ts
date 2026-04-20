import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  requireAgentAdminActionUserId,
  requireAgentAdminSignedInUserId,
} from '@/lib/agents/admin/auth';

export async function requireWidgetCodexReadAuth(request: NextRequest) {
  const admin = await requireAgentAdminSignedInUserId(request);
  if (admin.ok) {
    return null;
  }
  return NextResponse.json({ error: admin.error }, { status: admin.status });
}

export async function requireWidgetCodexActionAuth(request: NextRequest) {
  const admin = await requireAgentAdminActionUserId(request);
  if (admin.ok) {
    return null;
  }
  return NextResponse.json({ error: admin.error }, { status: admin.status });
}
