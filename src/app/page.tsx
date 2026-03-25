import { ResetWorkspaceShell } from '@present/ui';
import {
  buildCanvasSessionSnapshot,
  buildCanvasRuntimeSurface,
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
  const requestedWorkspace = requestedWorkspaceSessionId ? getWorkspaceSession(requestedWorkspaceSessionId) : null;

  if (requestedWorkspaceSessionId && !requestedWorkspace) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '32px',
          background:
            'radial-gradient(circle at top left, rgba(246,165,102,0.18), transparent 40%), linear-gradient(180deg, #11141b 0%, #0a0c10 100%)',
          color: '#f8eee5',
        }}
      >
        <article
          style={{
            width: 'min(92vw, 620px)',
            padding: '32px',
            borderRadius: '28px',
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(17, 20, 27, 0.82)',
            boxShadow: '0 20px 80px rgba(0,0,0,0.28)',
          }}
        >
          <div
            style={{
              font: '600 11px/1.1 ui-monospace, SFMono-Regular, monospace',
              letterSpacing: '.28em',
              textTransform: 'uppercase',
              color: '#f6a566',
              marginBottom: '14px',
            }}
          >
            Reset Workspace Missing
          </div>
          <h1 style={{ margin: '0 0 12px', fontSize: 'clamp(28px, 5vw, 42px)' }}>Invite Could Not Be Resolved</h1>
          <p style={{ margin: '0 0 18px', lineHeight: 1.6, color: 'rgba(248, 238, 229, 0.78)' }}>
            The requested workspace session is not available in this reset runtime, so PRESENT is refusing to open a
            different room under the same invite link.
          </p>
          <code
            style={{
              display: 'block',
              padding: '14px 16px',
              borderRadius: '18px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#f8eee5',
              overflowX: 'auto',
            }}
          >
            {requestedWorkspaceSessionId}
          </code>
          <div style={{ marginTop: '20px' }}>
            <a
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '44px',
                padding: '0 18px',
                borderRadius: '999px',
                background: '#f6a566',
                color: '#11141b',
                textDecoration: 'none',
                fontWeight: 700,
              }}
            >
              Open Local Reset Workspace
            </a>
          </div>
        </article>
      </main>
    );
  }

  const workspace =
    requestedWorkspace ??
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
      title: 'Canvas OS Brief',
      mimeType: 'text/html',
      content: `<!doctype html><html lang="en"><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#111;color:#f4eadb;font-family:Georgia,serif"><div style="padding:32px;border:1px solid rgba(255,255,255,.1);border-radius:24px;background:rgba(255,255,255,.04)"><div style="font:600 11px/1.2 ui-monospace,monospace;letter-spacing:.28em;text-transform:uppercase;color:#f6a566;margin-bottom:12px">PRESENT CANVAS OS</div><h1 style="margin:0 0 10px;font-size:40px">Shared Board Runtime</h1><p style="margin:0;color:rgba(244,234,219,.75)">Humans, agents, widgets, runs, and approvals now meet on one canvas-native surface.</p></div></body></html>`,
      metadata: {
        seed: true,
      },
    });
  }

  const [runtimeSurface, modelProfiles] = await Promise.all([
    Promise.resolve(buildCanvasRuntimeSurface(workspace)),
    resolveKernelModelProfiles(),
  ]);
  const canvasSession = buildCanvasSessionSnapshot(workspace, {
    runtimeSurface,
    traceLimit: 24,
  });

  return (
    <ResetWorkspaceShell
      initialManifest={runtimeSurface.manifest}
      initialRegistry={runtimeSurface.registry}
      initialAgentPack={runtimeSurface.agentPack}
      initialCanvasSession={canvasSession}
      initialWorkspace={workspace}
      initialWorkspaces={listWorkspaceSessions().slice(0, 6)}
      initialExecutors={listExecutorSessions(workspace.id)}
      initialTasks={listTaskRuns(workspace.id)}
      initialArtifacts={listArtifacts(workspace.id)}
      initialApprovals={listApprovalRequests(workspace.id)}
      initialPresence={listPresenceMembers(workspace.id)}
      initialModelProfiles={modelProfiles}
      initialTraceEvents={listTraceEvents({ workspaceSessionId: workspace.id, limit: 80 })}
    />
  );
}
