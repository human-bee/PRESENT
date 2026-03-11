import { NextResponse } from 'next/server';
import { buildRuntimeManifest, resolveKernelModelProfiles } from '@present/kernel';
import { buildCodexAppServerManifest } from '@present/codex-adapter';
import { hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

export async function GET() {
  await hydrateResetKernel();
  const [modelProfiles] = await Promise.all([resolveKernelModelProfiles()]);
  return NextResponse.json({
    manifest: buildRuntimeManifest(),
    codex: buildCodexAppServerManifest(),
    modelProfiles,
  });
}
