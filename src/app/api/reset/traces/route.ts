import { NextRequest, NextResponse } from 'next/server';
import { listTraceEvents, searchTraceEvents } from '@present/kernel';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const traceId = request.nextUrl.searchParams.get('traceId');
  const query = request.nextUrl.searchParams.get('query');

  if (query) {
    return NextResponse.json({ events: searchTraceEvents(query) });
  }

  return NextResponse.json({ events: listTraceEvents(traceId ?? undefined) });
}
