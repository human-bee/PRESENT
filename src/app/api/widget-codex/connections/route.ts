import { NextRequest, NextResponse } from 'next/server';
import { createWidgetCodexConnection } from '@present/widget-codex/client';
import { widgetCodexCreateConnectionInputSchema } from '@present/widget-codex/contracts';
import { toWidgetCodexErrorResponse } from '@/lib/widget-codex/api-error';
import { requireWidgetCodexActionAuth } from '@/lib/widget-codex/route-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authResponse = await requireWidgetCodexActionAuth(request);
  if (authResponse) return authResponse;
  try {
    const payload = widgetCodexCreateConnectionInputSchema.parse(await request.json());
    const response = await createWidgetCodexConnection(payload);
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toWidgetCodexErrorResponse(error, 'Failed to create Widget Codex connection.');
  }
}
