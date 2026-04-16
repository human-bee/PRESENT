import { NextResponse } from 'next/server';
import { getWorkspaceStateSnapshot } from '@present/kernel';
import { hydrateResetKernel } from '../../../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceSessionId: string }> },
) {
  await hydrateResetKernel();
  const { workspaceSessionId } = await params;
  const url = new URL(request.url ?? 'http://localhost');
  const traceQuery = url.searchParams.get('traceQuery')?.trim() || undefined;
  const traceLimitParam = url.searchParams.get('traceLimit');
  const includeTraces = url.searchParams.get('includeTraces') !== 'false';
  const includeManifest = url.searchParams.get('includeManifest') !== 'false';
  const traceLimit =
    typeof traceLimitParam === 'string' && /^\d+$/.test(traceLimitParam)
      ? Number.parseInt(traceLimitParam, 10)
      : undefined;
  const snapshot = await getWorkspaceStateSnapshot(workspaceSessionId, {
    includeTraces,
    traceQuery,
    traceLimit,
    includeManifest,
  });
  if (!snapshot) {
    return NextResponse.json({ error: 'Workspace session not found' }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
