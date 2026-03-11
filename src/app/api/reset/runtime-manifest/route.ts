import { NextResponse } from 'next/server';
import { buildRuntimeManifest, resolveKernelModelProfiles } from '@present/kernel';
import { buildCodexAppServerManifest } from '@present/codex-adapter';

export const runtime = 'nodejs';

export async function GET() {
  const [modelProfiles] = await Promise.all([resolveKernelModelProfiles()]);
  return NextResponse.json({
    manifest: buildRuntimeManifest(),
    codex: buildCodexAppServerManifest(),
    modelProfiles,
  });
}
