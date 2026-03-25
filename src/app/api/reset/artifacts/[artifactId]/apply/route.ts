import { NextResponse } from 'next/server';
import { applyArtifactPatch } from '@present/kernel';
import { flushResetKernelWrites, hydrateResetKernel } from '../../../_lib/persistence';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    await hydrateResetKernel();
    const { artifactId } = await context.params;
    const artifact = applyArtifactPatch(artifactId);
    await flushResetKernelWrites();
    return NextResponse.json({ artifact });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply patch artifact';
    const status = message === 'Artifact not found' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
