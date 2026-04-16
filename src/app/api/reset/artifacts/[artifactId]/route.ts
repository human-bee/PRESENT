import { NextResponse } from 'next/server';
import { getArtifact } from '@present/kernel';
import { hydrateResetKernel } from '../../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  await hydrateResetKernel();
  const { artifactId } = await context.params;
  const workspaceSessionId = new URL(request.url).searchParams.get('workspaceSessionId')?.trim();
  if (!workspaceSessionId) {
    return NextResponse.json({ error: 'workspaceSessionId is required' }, { status: 400 });
  }
  const artifact = getArtifact(artifactId);
  if (!artifact || artifact.workspaceSessionId !== workspaceSessionId) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  }
  return NextResponse.json({ artifact });
}
