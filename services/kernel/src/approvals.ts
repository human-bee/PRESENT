import { approvalRequestSchema, type ApprovalRequest } from '@present/contracts';
import { createResetId, RESET_ID_PREFIXES } from './ids';
import { readResetCollection, writeResetCollection } from './persistence';
import { recordKernelEvent } from './traces';

export function listApprovalRequests(workspaceSessionId?: string) {
  return readResetCollection('approvals')
    .filter((approval) => !workspaceSessionId || approval.workspaceSessionId === workspaceSessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getApprovalRequest(approvalRequestId: string) {
  return listApprovalRequests().find((approval) => approval.id === approvalRequestId) ?? null;
}

export function createApprovalRequest(input: {
  workspaceSessionId: string;
  traceId: string;
  taskRunId?: string | null;
  kind: ApprovalRequest['kind'];
  title: string;
  detail: string;
  requestedBy: string;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const approval = approvalRequestSchema.parse({
    id: createResetId(RESET_ID_PREFIXES.approval),
    workspaceSessionId: input.workspaceSessionId,
    traceId: input.traceId,
    taskRunId: input.taskRunId ?? null,
    kind: input.kind,
    state: 'pending',
    title: input.title,
    detail: input.detail,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt ?? null,
    requestedBy: input.requestedBy,
    resolvedBy: null,
    metadata: input.metadata ?? {},
  });
  writeResetCollection('approvals', [approval, ...listApprovalRequests()]);
  recordKernelEvent({
    type: 'approval.requested',
    traceId: approval.traceId,
    workspaceSessionId: approval.workspaceSessionId,
    approvalRequestId: approval.id,
    state: approval.state,
    summary: approval.title,
    metadata: approval.metadata,
  });
  return approval;
}

export function resolveApprovalRequest(input: {
  approvalRequestId: string;
  state: 'approved' | 'rejected' | 'expired';
  resolvedBy: string;
}) {
  const current = getApprovalRequest(input.approvalRequestId);
  if (!current) return null;
  if (current.state !== 'pending') {
    if (current.state === input.state) {
      return current;
    }
    throw new Error('Approval request can only be resolved while pending');
  }
  const next = approvalRequestSchema.parse({
    ...current,
    state: input.state,
    resolvedBy: input.resolvedBy,
    updatedAt: new Date().toISOString(),
  });
  writeResetCollection(
    'approvals',
    [...listApprovalRequests().filter((approval) => approval.id !== next.id), next].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
  recordKernelEvent({
    type: 'approval.resolved',
    traceId: next.traceId,
    workspaceSessionId: next.workspaceSessionId,
    approvalRequestId: next.id,
    state: next.state,
    summary: next.title,
    metadata: next.metadata,
  });
  return next;
}

export function consumeApprovalRequest(input: {
  approvalRequestId: string;
  workspaceSessionId: string;
  resolvedBy: string;
  requiredKinds?: ApprovalRequest['kind'][];
  metadata?: Record<string, unknown>;
}) {
  const current = getApprovalRequest(input.approvalRequestId);
  if (!current) {
    throw new Error('Approval request not found');
  }
  if (current.workspaceSessionId !== input.workspaceSessionId) {
    throw new Error('Approval request does not match workspace session');
  }
  if (current.state !== 'approved') {
    throw new Error('Approval request is not approved');
  }

  const now = new Date().toISOString();
  if (current.expiresAt && current.expiresAt < now) {
    throw new Error('Approval request has expired');
  }

  const requiredKinds = input.requiredKinds ?? ['file_write', 'git_action'];
  if (!requiredKinds.includes(current.kind)) {
    throw new Error('Approval request does not grant the requested capability');
  }

  const next = approvalRequestSchema.parse({
    ...current,
    state: 'expired',
    resolvedBy: input.resolvedBy,
    updatedAt: now,
    metadata: {
      ...current.metadata,
      ...input.metadata,
      consumedAt: now,
      consumedBy: input.resolvedBy,
    },
  });

  writeResetCollection(
    'approvals',
    [...listApprovalRequests().filter((approval) => approval.id !== next.id), next].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
  recordKernelEvent({
    type: 'approval.resolved',
    traceId: next.traceId,
    workspaceSessionId: next.workspaceSessionId,
    approvalRequestId: next.id,
    state: next.state,
    summary: next.title,
    metadata: next.metadata,
  });
  return next;
}
