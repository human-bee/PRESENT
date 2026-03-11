import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createWorkspacePatchArtifact, listWorkspaceFiles } from '@present/kernel';

export const runtime = 'nodejs';

const createPatchArtifactSchema = z.object({
  filePath: z.string().min(1),
  nextContent: z.string(),
  traceId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceSessionId: string }> },
) {
  try {
    const { workspaceSessionId } = await context.params;
    const url = new URL(request.url);
    const directoryPath = url.searchParams.get('directoryPath');
    const limit = Number(url.searchParams.get('limit') ?? '200');
    const files = listWorkspaceFiles({
      workspaceSessionId,
      directoryPath,
      limit: Number.isFinite(limit) ? limit : 200,
    });
    return NextResponse.json({ files });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list workspace files' },
      { status: 400 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSessionId: string }> },
) {
  try {
    const { workspaceSessionId } = await context.params;
    const payload = createPatchArtifactSchema.parse(await request.json());
    const artifact = createWorkspacePatchArtifact({
      workspaceSessionId,
      filePath: payload.filePath,
      nextContent: payload.nextContent,
      traceId: payload.traceId,
      title: payload.title,
    });
    return NextResponse.json({ artifact }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create patch artifact' },
      { status: 400 },
    );
  }
}
