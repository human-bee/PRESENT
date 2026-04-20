import { NextRequest, NextResponse } from 'next/server';
import { deleteWidgetCodexConnection, getWidgetCodexConnection } from '@present/widget-codex/client';
import { toWidgetCodexErrorResponse } from '@/lib/widget-codex/api-error';
import { requireWidgetCodexActionAuth, requireWidgetCodexReadAuth } from '@/lib/widget-codex/route-auth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const authResponse = await requireWidgetCodexReadAuth(request);
  if (authResponse) return authResponse;
  try {
    const { connectionId } = await params;
    const response = await getWidgetCodexConnection(connectionId);
    return NextResponse.json(response);
  } catch (error) {
    return toWidgetCodexErrorResponse(error, 'Failed to load Widget Codex connection.');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const authResponse = await requireWidgetCodexActionAuth(request);
  if (authResponse) return authResponse;
  try {
    const { connectionId } = await params;
    const response = await deleteWidgetCodexConnection(connectionId);
    return NextResponse.json(response);
  } catch (error) {
    return toWidgetCodexErrorResponse(error, 'Failed to delete Widget Codex connection.');
  }
}
