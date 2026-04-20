import { NextRequest, NextResponse } from 'next/server';
import { deleteWidgetCodexServer, updateWidgetCodexServer } from '@present/widget-codex/client';
import { widgetCodexServerPatchSchema } from '@present/widget-codex/contracts';
import { toWidgetCodexErrorResponse } from '@/lib/widget-codex/api-error';
import { requireWidgetCodexActionAuth } from '@/lib/widget-codex/route-auth';

export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const authResponse = await requireWidgetCodexActionAuth(request);
  if (authResponse) return authResponse;
  try {
    const { serverId } = await params;
    const payload = widgetCodexServerPatchSchema.parse(await request.json());
    const response = await updateWidgetCodexServer(serverId, payload);
    return NextResponse.json(response);
  } catch (error) {
    return toWidgetCodexErrorResponse(error, 'Failed to update Widget Codex server.');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const authResponse = await requireWidgetCodexActionAuth(request);
  if (authResponse) return authResponse;
  try {
    const { serverId } = await params;
    const response = await deleteWidgetCodexServer(serverId);
    return NextResponse.json(response);
  } catch (error) {
    return toWidgetCodexErrorResponse(error, 'Failed to delete Widget Codex server.');
  }
}
