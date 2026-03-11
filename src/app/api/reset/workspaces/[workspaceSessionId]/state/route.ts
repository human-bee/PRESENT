import { NextResponse } from 'next/server';
import { getWorkspaceStateSnapshot } from '@present/kernel';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceSessionId: string }> },
) {
  const { workspaceSessionId } = await params;
  const snapshot = await getWorkspaceStateSnapshot(workspaceSessionId);
  if (!snapshot) {
    return NextResponse.json({ error: 'Workspace session not found' }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
