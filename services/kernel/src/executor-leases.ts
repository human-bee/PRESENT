import { createResetId, RESET_ID_PREFIXES } from './ids';
import { readResetCollection, writeResetCollection } from './persistence';

export type KernelExecutorLease = {
  id: string;
  workspaceSessionId: string;
  identity: string;
  leaseExpiresAt: string;
  updatedAt: string;
};

const listLeases = () =>
  readResetCollection('leases').sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export function readExecutorLease(workspaceSessionId: string) {
  const lease = listLeases().find((entry) => entry.workspaceSessionId === workspaceSessionId);
  if (!lease) return null;
  if (Date.parse(lease.leaseExpiresAt) <= Date.now()) {
    writeResetCollection(
      'leases',
      listLeases().filter((entry) => entry.workspaceSessionId !== workspaceSessionId),
    );
    return null;
  }
  return lease;
}

export function claimExecutorLease(input: {
  workspaceSessionId: string;
  identity: string;
  leaseTtlMs?: number;
}) {
  const now = Date.now();
  const current = readExecutorLease(input.workspaceSessionId);
  if (current && current.identity !== input.identity) {
    return {
      acquired: false as const,
      lease: current,
    };
  }
  const lease = {
    id: current?.id ?? createResetId(RESET_ID_PREFIXES.trace),
    workspaceSessionId: input.workspaceSessionId,
    identity: input.identity,
    leaseExpiresAt: new Date(now + Math.max(5_000, Math.min(60_000, input.leaseTtlMs ?? 15_000))).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  writeResetCollection(
    'leases',
    [...listLeases().filter((entry) => entry.workspaceSessionId !== input.workspaceSessionId), lease].sort(
      (left, right) => right.updatedAt.localeCompare(left.updatedAt),
    ),
  );
  return {
    acquired: true as const,
    lease,
  };
}

export function heartbeatExecutorLease(input: {
  workspaceSessionId: string;
  identity: string;
  leaseTtlMs?: number;
}) {
  return claimExecutorLease(input);
}

export function releaseExecutorLease(workspaceSessionId: string, identity: string) {
  const current = readExecutorLease(workspaceSessionId);
  if (!current) return { released: true as const };
  if (current.identity !== identity) {
    return { released: false as const, lease: current };
  }
  writeResetCollection(
    'leases',
    listLeases().filter((entry) => entry.workspaceSessionId !== workspaceSessionId),
  );
  return { released: true as const };
}
