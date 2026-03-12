import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { heartbeatExecutorSession } from '@present/kernel';
import { flushResetKernelWrites, hydrateResetKernel } from '../../_lib/persistence';

export const runtime = 'nodejs';

const heartbeatSchema = z.object({
  executorSessionId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  await hydrateResetKernel();
  const payload = heartbeatSchema.parse(await request.json());
  const executorSession = heartbeatExecutorSession(payload.executorSessionId);
  if (!executorSession) {
    return NextResponse.json({ error: 'Executor session not found' }, { status: 404 });
  }
  await flushResetKernelWrites();
  return NextResponse.json({ executorSession });
}
