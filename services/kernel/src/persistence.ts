import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  approvalRequestSchema,
  artifactSchema,
  executorSessionSchema,
  modelProfileSchema,
  presenceMemberSchema,
  taskRunSchema,
  workspaceSessionSchema,
} from '@present/contracts';
import { kernelEventSchema } from '@present/contracts';
import type {
  ApprovalRequest,
  Artifact,
  ExecutorSession,
  KernelEvent,
  ModelProfile,
  PresenceMember,
  TaskRun,
  WorkspaceSession,
} from '@present/contracts';
import type { KernelExecutorLease } from './executor-leases';

const leaseSchema = z.object({
  id: z.string().min(1),
  workspaceSessionId: z.string().min(1),
  identity: z.string().min(1),
  leaseExpiresAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const resetKernelStateSchema = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(workspaceSessionSchema).default([]),
  executors: z.array(executorSessionSchema).default([]),
  leases: z.array(leaseSchema).default([]),
  tasks: z.array(taskRunSchema).default([]),
  artifacts: z.array(artifactSchema).default([]),
  approvals: z.array(approvalRequestSchema).default([]),
  presence: z.array(presenceMemberSchema).default([]),
  modelProfiles: z.array(modelProfileSchema).default([]),
  traces: z.array(kernelEventSchema).default([]),
});

export type ResetKernelState = z.infer<typeof resetKernelStateSchema>;

const defaultResetKernelState = (): ResetKernelState => ({
  schemaVersion: 1,
  workspaces: [],
  executors: [],
  leases: [],
  tasks: [],
  artifacts: [],
  approvals: [],
  presence: [],
  modelProfiles: [],
  traces: [],
});

const getStatePath = () =>
  process.env.PRESENT_RESET_STATE_PATH ?? path.join(process.cwd(), '.tmp', 'present-reset-state.json');

const ensureParentDirectory = (statePath: string) => {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
};

const readPersistedState = (): ResetKernelState => {
  const statePath = getStatePath();
  if (!fs.existsSync(statePath)) return defaultResetKernelState();

  try {
    const text = fs.readFileSync(statePath, 'utf8');
    if (!text.trim()) return defaultResetKernelState();
    return resetKernelStateSchema.parse(JSON.parse(text));
  } catch {
    return defaultResetKernelState();
  }
};

const writePersistedState = (state: ResetKernelState) => {
  const statePath = getStatePath();
  ensureParentDirectory(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
};

export const readResetKernelState = () => readPersistedState();

export function mutateResetKernelState<T>(mutator: (state: ResetKernelState) => T) {
  const state = readPersistedState();
  const result = mutator(state);
  writePersistedState(resetKernelStateSchema.parse(state));
  return result;
}

type ResetCollectionKey =
  | 'workspaces'
  | 'executors'
  | 'leases'
  | 'tasks'
  | 'artifacts'
  | 'approvals'
  | 'presence'
  | 'modelProfiles'
  | 'traces';

type ResetCollectionMap = {
  workspaces: WorkspaceSession;
  executors: ExecutorSession;
  leases: KernelExecutorLease;
  tasks: TaskRun;
  artifacts: Artifact;
  approvals: ApprovalRequest;
  presence: PresenceMember;
  modelProfiles: ModelProfile;
  traces: KernelEvent;
};

export function readResetCollection<K extends ResetCollectionKey>(key: K): ResetCollectionMap[K][] {
  return [...readPersistedState()[key]] as ResetCollectionMap[K][];
}

export function writeResetCollection<K extends ResetCollectionKey>(key: K, value: ResetCollectionMap[K][]) {
  return mutateResetKernelState((state) => {
    state[key] = [...value] as unknown as ResetKernelState[K];
    return state[key];
  });
}

export function resetKernelStateForTests() {
  const statePath = getStatePath();
  if (fs.existsSync(statePath)) {
    fs.rmSync(statePath, { force: true });
  }
}

export function getResetKernelStatePath() {
  return getStatePath();
}
