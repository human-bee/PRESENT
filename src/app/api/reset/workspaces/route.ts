import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listWorkspaceSessions, openWorkspaceSession } from '@present/kernel';

export const runtime = 'nodejs';

const openWorkspaceSchema = z.object({
  workspacePath: z.string().min(1),
  branch: z.string().optional(),
  title: z.string().optional(),
  ownerUserId: z.string().optional(),
});

export async function GET() {
  return NextResponse.json({ workspaces: listWorkspaceSessions() });
}

export async function POST(request: NextRequest) {
  const payload = openWorkspaceSchema.parse(await request.json());
  const workspace = openWorkspaceSession(payload);
  return NextResponse.json({ workspace }, { status: 201 });
}
