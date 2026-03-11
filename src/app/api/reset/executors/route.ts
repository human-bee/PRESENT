import { NextRequest, NextResponse } from 'next/server';
import { listExecutorSessions } from '@present/kernel';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId') ?? undefined;
  return NextResponse.json({ executors: listExecutorSessions(workspaceSessionId) });
}
