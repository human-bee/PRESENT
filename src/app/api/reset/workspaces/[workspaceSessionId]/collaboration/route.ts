import { NextRequest, NextResponse } from 'next/server';
import {
  ensureResetKernelHydrated,
  getCollaborationDocument,
  getWorkspaceSession,
  upsertCollaborationDocument,
} from '@present/kernel';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceSessionId: string }> },
) {
  await ensureResetKernelHydrated();
  const { workspaceSessionId } = await context.params;
  const workspace = getWorkspaceSession(workspaceSessionId);
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace session not found.' }, { status: 404 });
  }

  const filePath = request.nextUrl.searchParams.get('filePath')?.trim();
  const sourceUpdatedAt = request.nextUrl.searchParams.get('sourceUpdatedAt')?.trim() || null;
  if (!filePath) {
    return NextResponse.json({ error: 'filePath is required.' }, { status: 400 });
  }

  const document = await getCollaborationDocument(workspaceSessionId, filePath, sourceUpdatedAt);
  return NextResponse.json({
    document: document ?? {
      workspaceSessionId,
      filePath,
      encodedState: '',
      version: 0,
      updatedAt: new Date(0).toISOString(),
      collaborators: [],
    },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceSessionId: string }> },
) {
  await ensureResetKernelHydrated();
  const { workspaceSessionId } = await context.params;
  const workspace = getWorkspaceSession(workspaceSessionId);
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace session not found.' }, { status: 404 });
  }

  const body = (await request.json()) as {
    filePath?: string;
    sourceUpdatedAt?: string;
    encodedState?: string;
    identity?: string;
    displayName?: string;
    seedContent?: string;
  };

  if (!body.filePath?.trim()) {
    return NextResponse.json({ error: 'filePath is required.' }, { status: 400 });
  }

  if (typeof body.encodedState !== 'string') {
    return NextResponse.json({ error: 'encodedState is required.' }, { status: 400 });
  }

  if (!body.identity?.trim() || !body.displayName?.trim()) {
    return NextResponse.json({ error: 'identity and displayName are required.' }, { status: 400 });
  }

  const document = await upsertCollaborationDocument({
    workspaceSessionId,
    filePath: body.filePath,
    sourceUpdatedAt: body.sourceUpdatedAt?.trim() || null,
    encodedState: body.encodedState,
    identity: body.identity,
    displayName: body.displayName,
    seedContent: body.seedContent,
  });

  return NextResponse.json({ document });
}
