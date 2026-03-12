import { NextRequest, NextResponse } from 'next/server';
import { buildAgentInteropPack, buildRuntimeManifest, getWorkspaceSession, resolveKernelModelProfiles } from '@present/kernel';
import { buildCodexAppServerManifest } from '@present/codex-adapter';
import { hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId');
  const workspace = workspaceSessionId ? getWorkspaceSession(workspaceSessionId) : null;
  const [modelProfiles] = await Promise.all([resolveKernelModelProfiles()]);
  return NextResponse.json({
    manifest: buildRuntimeManifest(),
    codex: buildCodexAppServerManifest(),
    modelProfiles,
    agentPack: buildAgentInteropPack(workspace),
  });
}
