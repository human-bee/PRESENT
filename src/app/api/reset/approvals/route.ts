import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createApprovalRequest, listApprovalRequests, resolveApprovalRequest } from '@present/kernel';
import { flushResetKernelWrites, hydrateResetKernel } from '../_lib/persistence';

export const runtime = 'nodejs';

const createApprovalSchema = z.object({
  workspaceSessionId: z.string().min(1),
  traceId: z.string().min(1),
  taskRunId: z.string().optional(),
  kind: z.enum(['file_write', 'shell_exec', 'network_access', 'git_action', 'tool_escalation']),
  title: z.string().min(1),
  detail: z.string().min(1),
  requestedBy: z.string().min(1),
});

const resolveApprovalSchema = z.object({
  approvalRequestId: z.string().min(1),
  state: z.enum(['approved', 'rejected', 'expired']),
  resolvedBy: z.string().min(1),
});

export async function GET(request: NextRequest) {
  await hydrateResetKernel();
  const workspaceSessionId = request.nextUrl.searchParams.get('workspaceSessionId') ?? undefined;
  return NextResponse.json({ approvals: listApprovalRequests(workspaceSessionId) });
}

export async function POST(request: NextRequest) {
  await hydrateResetKernel();
  const payload = await request.json();
  if (payload?.approvalRequestId) {
    const resolved = resolveApprovalSchema.parse(payload);
    const approval = resolveApprovalRequest(resolved);
    if (!approval) {
      return NextResponse.json({ error: 'Approval request not found' }, { status: 404 });
    }
    await flushResetKernelWrites();
    return NextResponse.json({ approval });
  }

  const created = createApprovalSchema.parse(payload);
  const approval = createApprovalRequest(created);
  await flushResetKernelWrites();
  return NextResponse.json({ approval }, { status: 201 });
}
