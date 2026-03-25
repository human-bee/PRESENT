import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { enqueueTaskRun, listTaskRuns } from '@present/kernel';
import { flushResetKernelWrites, hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

const enqueueTaskSchema = z.object({
  workspaceSessionId: z.string().min(1),
  summary: z.string().min(1),
  taskType: z.string().min(1),
  prompt: z.string().optional(),
  room: z.string().optional(),
  requestId: z.string().optional(),
  dedupeKey: z.string().optional(),
});

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId') ?? undefined;
  return NextResponse.json({ tasks: listTaskRuns(workspaceSessionId) });
}

export async function POST(request: Request) {
  try {
    await hydrateResetKernel();
    const payload = enqueueTaskSchema.parse(await request.json());
    const taskRun = await enqueueTaskRun({
      workspaceSessionId: payload.workspaceSessionId,
      summary: payload.summary,
      taskType: payload.taskType,
      room: payload.room,
      requestId: payload.requestId,
      dedupeKey: payload.dedupeKey,
      params: payload.prompt ? { prompt: payload.prompt } : {},
    });
    await flushResetKernelWrites();
    return NextResponse.json({ taskRun }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue reset task' },
      { status: 400 },
    );
  }
}
