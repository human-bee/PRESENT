import { NextRequest, NextResponse } from 'next/server';
import { listExecutorSessions } from '@present/kernel';
import { hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId') ?? undefined;
  return NextResponse.json({ executors: listExecutorSessions(workspaceSessionId) });
}
