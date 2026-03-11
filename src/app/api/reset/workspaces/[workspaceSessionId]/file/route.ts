import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readWorkspaceFile, writeWorkspaceFile } from '@present/kernel';

export const runtime = 'nodejs';

const writeWorkspaceFileSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ workspaceSessionId: string }> },
) {
  try {
    const { workspaceSessionId } = await context.params;
    const filePath = new URL(request.url).searchParams.get('filePath');
    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 });
    }
    const document = readWorkspaceFile({ workspaceSessionId, filePath });
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read workspace file' },
      { status: 400 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ workspaceSessionId: string }> },
) {
  try {
    const { workspaceSessionId } = await context.params;
    const payload = writeWorkspaceFileSchema.parse(await request.json());
    const document = writeWorkspaceFile({
      workspaceSessionId,
      filePath: payload.filePath,
      content: payload.content,
    });
    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to write workspace file' },
      { status: 400 },
    );
  }
}
