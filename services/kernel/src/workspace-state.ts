import type { ModelProfile } from '@present/contracts';
import { buildRuntimeManifest } from './runtime-manifest';
import { listApprovalRequests } from './approvals';
import { listArtifacts } from './artifacts';
import { listExecutorSessions } from './executor-sessions';
import { resolveKernelModelProfiles } from './model-profiles';
import { listPresenceMembers } from './presence';
import { listTaskRuns } from './tasks';
import { listTraceEvents } from './traces';
import { getWorkspaceSession } from './workspace-sessions';

export type WorkspaceStateSnapshot = {
  workspace: ReturnType<typeof getWorkspaceSession>;
  executors: ReturnType<typeof listExecutorSessions>;
  tasks: ReturnType<typeof listTaskRuns>;
  artifacts: ReturnType<typeof listArtifacts>;
  approvals: ReturnType<typeof listApprovalRequests>;
  presence: ReturnType<typeof listPresenceMembers>;
  traces: ReturnType<typeof listTraceEvents>;
  modelProfiles: ModelProfile[];
  manifest: ReturnType<typeof buildRuntimeManifest>;
};

export async function getWorkspaceStateSnapshot(workspaceSessionId: string): Promise<WorkspaceStateSnapshot | null> {
  const workspace = getWorkspaceSession(workspaceSessionId);
  if (!workspace) return null;

  return {
    workspace,
    executors: listExecutorSessions(workspaceSessionId),
    tasks: listTaskRuns(workspaceSessionId),
    artifacts: listArtifacts(workspaceSessionId),
    approvals: listApprovalRequests(workspaceSessionId),
    presence: listPresenceMembers(workspaceSessionId),
    traces: listTraceEvents().filter((event) => event.workspaceSessionId === workspaceSessionId),
    modelProfiles: await resolveKernelModelProfiles(),
    manifest: buildRuntimeManifest(),
  };
}
