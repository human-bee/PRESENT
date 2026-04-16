import { NextResponse } from 'next/server';
import { getTaskRun } from '@present/kernel';
import { hydrateResetKernel } from '../../_lib/persistence';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  await hydrateResetKernel();
  const { taskId } = await context.params;
  const taskRun = await getTaskRun(taskId);
  if (!taskRun) {
    return NextResponse.json({ error: 'Task run not found' }, { status: 404 });
  }
  return NextResponse.json({ taskRun });
}
