import { NextRequest, NextResponse } from 'next/server';
import { completeWidgetCodexAuth } from '@present/widget-codex/client';
import { toWidgetCodexErrorResponse } from '@/lib/widget-codex/api-error';
import { requireWidgetCodexActionAuth } from '@/lib/widget-codex/route-auth';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const authResponse = await requireWidgetCodexActionAuth(request);
  if (authResponse) return authResponse;
  try {
    const { serverId } = await params;
    const body = await request.json().catch(() => ({}));
    const response = await completeWidgetCodexAuth(serverId, body);
    return NextResponse.json(response);
  } catch (error) {
    return toWidgetCodexErrorResponse(error, 'Failed to complete Widget Codex auth.');
  }
}
