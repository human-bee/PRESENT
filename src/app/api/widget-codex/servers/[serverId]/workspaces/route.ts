import { NextRequest, NextResponse } from 'next/server';
import { listWidgetCodexWorkspaces } from '@present/widget-codex/client';
import { toWidgetCodexErrorResponse } from '@/lib/widget-codex/api-error';
import { requireWidgetCodexReadAuth } from '@/lib/widget-codex/route-auth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const authResponse = await requireWidgetCodexReadAuth(request);
  if (authResponse) return authResponse;
  try {
    const { serverId } = await params;
    const response = await listWidgetCodexWorkspaces(serverId);
    return NextResponse.json(response);
  } catch (error) {
    return toWidgetCodexErrorResponse(error, 'Failed to load Widget Codex workspaces.');
  }
}
