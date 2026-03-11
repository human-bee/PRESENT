import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { heartbeatExecutorSession } from '@present/kernel';

export const runtime = 'nodejs';

const heartbeatSchema = z.object({
  executorSessionId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const payload = heartbeatSchema.parse(await request.json());
  const executorSession = heartbeatExecutorSession(payload.executorSessionId);
  if (!executorSession) {
    return NextResponse.json({ error: 'Executor session not found' }, { status: 404 });
  }
  return NextResponse.json({ executorSession });
}
