import { NextRequest, NextResponse } from 'next/server';
import { listTraceEvents, searchTraceEvents } from '@present/kernel';
import { hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const traceId = request.nextUrl.searchParams.get('traceId');
  const query = request.nextUrl.searchParams.get('query');
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId');
  const emittedAfterOrAt = request.nextUrl.searchParams.get('emittedAfterOrAt');
  const limitParam = request.nextUrl.searchParams.get('limit');
  const order = request.nextUrl.searchParams.get('order');
  const limit =
    typeof limitParam === 'string' && /^\d+$/.test(limitParam) ? Number.parseInt(limitParam, 10) : undefined;

  if (query) {
    return NextResponse.json({
      events: searchTraceEvents(query, {
        traceId: traceId ?? undefined,
        workspaceSessionId: workspaceSessionId ?? undefined,
        emittedAfterOrAt: emittedAfterOrAt ?? undefined,
        limit,
        order: order === 'asc' ? 'asc' : 'desc',
      }),
    });
  }

  return NextResponse.json({
    events: listTraceEvents({
      traceId: traceId ?? undefined,
      workspaceSessionId: workspaceSessionId ?? undefined,
      emittedAfterOrAt: emittedAfterOrAt ?? undefined,
      limit,
      order: order === 'asc' ? 'asc' : 'desc',
    }),
  });
}
