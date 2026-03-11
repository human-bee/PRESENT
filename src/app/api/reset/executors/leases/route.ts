import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { claimExecutorLease, releaseExecutorLease } from '@present/kernel';
import { flushResetKernelWrites, hydrateResetKernel } from '../../_lib/persistence';

export const runtime = 'nodejs';

const leaseSchema = z.object({
  action: z.enum(['claim', 'release']),
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  leaseTtlMs: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  await hydrateResetKernel();
  const payload = leaseSchema.parse(await request.json());
  if (payload.action === 'release') {
    const response = NextResponse.json(releaseExecutorLease(payload.workspaceSessionId, payload.identity));
    await flushResetKernelWrites();
    return response;
  }

  const response = NextResponse.json(
    claimExecutorLease({
      workspaceSessionId: payload.workspaceSessionId,
      identity: payload.identity,
      leaseTtlMs: payload.leaseTtlMs,
    }),
  );
  await flushResetKernelWrites();
  return response;
}
