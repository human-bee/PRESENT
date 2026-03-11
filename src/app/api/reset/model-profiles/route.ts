import { NextRequest, NextResponse } from 'next/server';
import { resolveKernelModelProfiles } from '@present/kernel';
import { hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const searchParams = request.nextUrl.searchParams;
  const profiles = await resolveKernelModelProfiles({
    task: searchParams.get('task') ?? undefined,
    room: searchParams.get('room') ?? undefined,
    userId: searchParams.get('userId') ?? undefined,
    billingUserId: searchParams.get('billingUserId') ?? undefined,
  });
  return NextResponse.json({ modelProfiles: profiles });
}
