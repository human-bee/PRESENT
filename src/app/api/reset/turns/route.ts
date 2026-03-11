import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getTaskRun } from '@present/kernel';
import { startCodexTurn } from '@present/codex-adapter';
import { flushResetKernelWrites, hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

const startTurnSchema = z.object({
  workspaceSessionId: z.string().min(1),
  prompt: z.string().min(1),
  summary: z.string().min(1),
  taskRunId: z.string().optional(),
  executorSessionId: z.string().optional(),
  threadId: z.string().optional(),
  model: z.string().optional(),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  approvalPolicy: z.enum(['never', 'on-request', 'on-failure', 'untrusted']).optional(),
  networkAccessEnabled: z.boolean().optional(),
});

export async function GET(request: Request) {
  await hydrateResetKernel();
  const taskRunId = new URL(request.url).searchParams.get('taskRunId');
  if (!taskRunId) {
    return NextResponse.json({ error: 'taskRunId is required' }, { status: 400 });
  }
  const taskRun = await getTaskRun(taskRunId);
  if (!taskRun) {
    return NextResponse.json({ error: 'Task run not found' }, { status: 404 });
  }
  return NextResponse.json({ taskRun });
}

export async function POST(request: Request) {
  try {
    await hydrateResetKernel();
    const payload = startTurnSchema.parse(await request.json());
    const taskRun = await startCodexTurn(payload);
    await flushResetKernelWrites();
    return NextResponse.json({ taskRun }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start Codex turn' },
      { status: 400 },
    );
  }
}
