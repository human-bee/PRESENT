import { NextResponse } from 'next/server';
import { getArtifact } from '@present/kernel';
import { hydrateResetKernel } from '../../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  await hydrateResetKernel();
  const { artifactId } = await context.params;
  const artifact = getArtifact(artifactId);
  if (!artifact) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  }
  return NextResponse.json({ artifact });
}
