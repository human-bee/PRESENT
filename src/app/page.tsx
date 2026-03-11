import { ResetWorkspaceShell } from '@present/ui';
import {
  buildRuntimeManifest,
  createArtifact,
  ensureResetKernelHydrated,
  getWorkspaceSession,
  listExecutorSessions,
  listApprovalRequests,
  listArtifacts,
  listPresenceMembers,
  listTaskRuns,
  listTraceEvents,
  listWorkspaceSessions,
  openWorkspaceSession,
  resolveKernelModelProfiles,
} from '@present/kernel';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensureResetKernelHydrated();
  const params = await searchParams;
  const requestedWorkspaceSessionId =
    typeof params.workspace === 'string' && params.workspace.trim() ? params.workspace.trim() : null;
  const existingWorkspaces = listWorkspaceSessions();

  const workspace =
    (requestedWorkspaceSessionId ? getWorkspaceSession(requestedWorkspaceSessionId) : null) ??
    existingWorkspaces[0] ??
    openWorkspaceSession({
      workspacePath: process.cwd(),
      branch: 'codex/reset',
      title: 'PRESENT Reset Workspace',
      metadata: {
        shell: 'root',
      },
    });

  const artifacts = listArtifacts(workspace.id);
  if (!artifacts.some((artifact) => artifact.kind === 'widget_bundle')) {
    createArtifact({
      workspaceSessionId: workspace.id,
      kind: 'widget_bundle',
      title: 'Reset Brief',
      mimeType: 'text/html',
      content: `<!doctype html><html lang="en"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#111;color:#f4eadb;font-family:Georgia,serif"><div style="padding:32px;border:1px solid rgba(255,255,255,.1);border-radius:24px;background:rgba(255,255,255,.04)"><div style="font:600 11px/1.2 ui-monospace,monospace;letter-spacing:.28em;text-transform:uppercase;color:#f6a566;margin-bottom:12px">PRESENT RESET</div><h1 style="margin:0 0 10px;font-size:40px">Mission Control</h1><p style="margin:0;color:rgba(244,234,219,.75)">The new shell runs on workspace, task, artifact, approval, and trace contracts.</p></div></body></html>`,
      metadata: {
        seed: true,
      },
    });
  }

  const [manifest, modelProfiles] = await Promise.all([buildRuntimeManifest(), resolveKernelModelProfiles()]);

  return (
    <ResetWorkspaceShell
      initialManifest={manifest}
      initialWorkspace={workspace}
      initialWorkspaces={listWorkspaceSessions().slice(0, 6)}
      initialExecutors={listExecutorSessions(workspace.id)}
      initialTasks={listTaskRuns(workspace.id)}
      initialArtifacts={listArtifacts(workspace.id)}
      initialApprovals={listApprovalRequests(workspace.id)}
      initialPresence={listPresenceMembers(workspace.id)}
      initialModelProfiles={modelProfiles}
      initialTraceEvents={listTraceEvents()}
    />
  );
}
