import { NextRequest, NextResponse } from 'next/server';
import {
  buildCanvasRuntimeSurface,
  getWorkspaceSession,
  resolveKernelModelProfiles,
} from '@present/kernel';
import { buildCodexAppServerManifest } from '@present/codex-adapter';
import { hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId');
  const workspace = workspaceSessionId ? getWorkspaceSession(workspaceSessionId) : null;
  const [modelProfiles] = await Promise.all([resolveKernelModelProfiles()]);
  const runtimeSurface = buildCanvasRuntimeSurface(workspace);
  return NextResponse.json({
    manifest: runtimeSurface.manifest,
    registry: runtimeSurface.registry,
    codex: buildCodexAppServerManifest(),
    modelProfiles,
    agentPack: runtimeSurface.agentPack,
  });
}
