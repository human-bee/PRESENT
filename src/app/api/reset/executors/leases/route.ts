import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { claimExecutorLease, releaseExecutorLease } from '@present/kernel';

export const runtime = 'nodejs';

const leaseSchema = z.object({
  action: z.enum(['claim', 'release']),
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  leaseTtlMs: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  const payload = leaseSchema.parse(await request.json());
  if (payload.action === 'release') {
    return NextResponse.json(releaseExecutorLease(payload.workspaceSessionId, payload.identity));
  }

  return NextResponse.json(
    claimExecutorLease({
      workspaceSessionId: payload.workspaceSessionId,
      identity: payload.identity,
      leaseTtlMs: payload.leaseTtlMs,
    }),
  );
}
