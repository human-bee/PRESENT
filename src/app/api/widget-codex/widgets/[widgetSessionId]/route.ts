import { NextRequest, NextResponse } from 'next/server';
import { getWidgetCodexSnapshot } from '@present/widget-codex/client';
import { toWidgetCodexErrorResponse } from '@/lib/widget-codex/api-error';
import { requireWidgetCodexReadAuth } from '@/lib/widget-codex/route-auth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ widgetSessionId: string }> },
) {
  const authResponse = await requireWidgetCodexReadAuth(request);
  if (authResponse) return authResponse;
  try {
    const { widgetSessionId } = await params;
    const response = await getWidgetCodexSnapshot(widgetSessionId);
    return NextResponse.json(response);
  } catch (error) {
    return toWidgetCodexErrorResponse(error, 'Failed to load Widget Codex snapshot.');
  }
}
