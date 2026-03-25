import { NextResponse } from 'next/server';
import { z } from 'zod';
import { applyArtifactPatch } from '@present/kernel';
import { flushResetKernelWrites, hydrateResetKernel } from '../../../_lib/persistence';

export const runtime = 'nodejs';

const applyArtifactPatchSchema = z.object({
  approvalRequestId: z.string().min(1),
  resolvedBy: z.string().min(1).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
) {
  try {
    await hydrateResetKernel();
    const { artifactId } = await context.params;
    const payload = applyArtifactPatchSchema.parse(await request.json());
    const artifact = applyArtifactPatch({
      artifactId,
      approvalRequestId: payload.approvalRequestId,
      resolvedBy: payload.resolvedBy ?? 'mission-control',
    });
    await flushResetKernelWrites();
    return NextResponse.json({ artifact });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply patch artifact';
    const status =
      message === 'Artifact not found'
        ? 404
        : message.startsWith('Approval request')
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
