import { ResetWorkspaceShell } from '@present/ui';
import { redirect } from 'next/navigation';
import {
  buildAgentInteropPack,
  buildRuntimeManifest,
  createArtifact,
  ensureResetKernelHydrated,
  listExecutorSessions,
  listApprovalRequests,
  listArtifacts,
  listPresenceMembers,
  listTaskRuns,
  listWorkspaceTraceEvents,
  listWorkspaceSessions,
  openWorkspaceSession,
  resolveKernelModelProfiles,
} from '@present/kernel';
import { canonicalizeLegacyCanvasPathAndQuery } from '@/lib/legacy-canvas-route';

export const dynamic = 'force-dynamic';

function toUrlSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      searchParams.append(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        searchParams.append(key, entry);
      }
    }
  }
  return searchParams;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const canonicalLegacyCanvasPath = canonicalizeLegacyCanvasPathAndQuery('/', toUrlSearchParams(params));
  if (canonicalLegacyCanvasPath) {
    redirect(canonicalLegacyCanvasPath);
  }

  await ensureResetKernelHydrated();
  const requestedWorkspaceSessionId =
    typeof params.workspace === 'string' && params.workspace.trim() ? params.workspace.trim() : null;
  const existingWorkspaces = listWorkspaceSessions();

  const workspace =
    (requestedWorkspaceSessionId
      ? (existingWorkspaces.find((session) => session.id === requestedWorkspaceSessionId) ?? null)
      : null) ??
    existingWorkspaces[0] ??
    openWorkspaceSession({
      workspacePath: process.cwd(),
      branch: 'codex/reset',
      title: 'PRESENT Reset Workspace',
      metadata: {
        shell: 'root',
      },
    });
  const initialWorkspaces = existingWorkspaces.some((session) => session.id === workspace.id)
    ? existingWorkspaces
    : [workspace, ...existingWorkspaces];

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
      initialAgentPack={buildAgentInteropPack(workspace)}
      initialWorkspace={workspace}
      initialWorkspaces={initialWorkspaces.slice(0, 6)}
      initialExecutors={listExecutorSessions(workspace.id)}
      initialTasks={listTaskRuns(workspace.id)}
      initialArtifacts={listArtifacts(workspace.id)}
      initialApprovals={listApprovalRequests(workspace.id)}
      initialPresence={listPresenceMembers(workspace.id)}
      initialModelProfiles={modelProfiles}
      initialTraceEvents={listWorkspaceTraceEvents(workspace.id)}
    />
  );
}
