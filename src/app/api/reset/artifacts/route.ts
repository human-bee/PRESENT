import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createArtifact, listArtifacts } from '@present/kernel';
import { flushResetKernelWrites, hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

const createArtifactSchema = z.object({
  workspaceSessionId: z.string().min(1),
  traceId: z.string().nullable().optional(),
  kind: z.enum(['file_patch', 'command_output', 'widget_bundle', 'canvas_snapshot', 'trace_export', 'review_report']),
  title: z.string().min(1),
  mimeType: z.string().min(1),
  content: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId') ?? undefined;
  return NextResponse.json({ artifacts: listArtifacts(workspaceSessionId) });
}

export async function POST(request: Request) {
  try {
    await hydrateResetKernel();
    const payload = createArtifactSchema.parse(await request.json());
    const artifact = createArtifact(payload);
    await flushResetKernelWrites();
    return NextResponse.json({ artifact }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create artifact' },
      { status: 400 },
    );
  }
}
