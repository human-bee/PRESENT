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
import { buildRuntimeManifest } from './runtime-manifest';
import { resolveKernelModelProfiles } from './model-profiles';
import { readResetKernelState } from './persistence';

export type WorkspaceStateSnapshot = {
  workspace: WorkspaceSession;
  executors: ExecutorSession[];
  tasks: TaskRun[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  presence: PresenceMember[];
  traces: KernelEvent[];
  modelProfiles: ModelProfile[];
  manifest: ReturnType<typeof buildRuntimeManifest>;
};

const byUpdatedAtDesc = <T extends { updatedAt: string }>(left: T, right: T) =>
  right.updatedAt.localeCompare(left.updatedAt);

const byEmittedAtDesc = (left: KernelEvent, right: KernelEvent) =>
  right.emittedAt.localeCompare(left.emittedAt);

export async function getWorkspaceStateSnapshot(workspaceSessionId: string): Promise<WorkspaceStateSnapshot | null> {
  const state = readResetKernelState();
  const workspace = state.workspaces.find((session) => session.id === workspaceSessionId) ?? null;
  if (!workspace) return null;

  return {
    workspace,
    executors: state.executors
      .filter((session) => session.workspaceSessionId === workspaceSessionId)
      .sort(byUpdatedAtDesc),
    tasks: state.tasks
      .filter((task) => task.workspaceSessionId === workspaceSessionId)
      .sort(byUpdatedAtDesc),
    artifacts: state.artifacts
      .filter((artifact) => artifact.workspaceSessionId === workspaceSessionId)
      .sort(byUpdatedAtDesc),
    approvals: state.approvals
      .filter((approval) => approval.workspaceSessionId === workspaceSessionId)
      .sort(byUpdatedAtDesc),
    presence: state.presence
      .filter((member) => member.workspaceSessionId === workspaceSessionId)
      .sort(byUpdatedAtDesc),
    traces: state.traces
      .filter((event) => event.workspaceSessionId === workspaceSessionId)
      .sort(byEmittedAtDesc),
    modelProfiles: await resolveKernelModelProfiles(),
    manifest: buildRuntimeManifest(),
  };
}
