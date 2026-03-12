'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState, useDeferredValue } from 'react';
import type {
  ApprovalRequest,
  AgentInteropPack,
  Artifact,
  ExecutorSession,
  ModelProfile,
  PresenceMember,
  RuntimeManifest,
  TaskRun,
  WorkspaceFileDocument,
  WorkspaceFileEntry,
  WorkspaceSession,
} from '@present/contracts';
import { ArtifactPreviewFrame } from './artifact-preview-frame';
import { ResetCollaborationSurface } from './reset-collaboration-surface';

const initialDraft = `// Codex-native workspace draft
// This shell is backed by reset-era kernel contracts.

export async function runMission() {
  return {
    goal: 'code + canvas + realtime collaboration',
    status: 'reset-in-progress',
  };
}
`;

const defaultWidgetHtml = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(255,168,108,.34), transparent 40%),
          linear-gradient(180deg, #11141b 0%, #0a0c10 100%);
        color: #f8eee5;
        font-family: "Iowan Old Style", "Palatino Linotype", serif;
      }
      .card {
        width: min(92vw, 480px);
        padding: 28px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 26px;
        background: rgba(17, 20, 27, .76);
        box-shadow: 0 20px 80px rgba(0,0,0,.3);
      }
      .eyebrow {
        font: 600 11px/1.1 ui-monospace, SFMono-Regular, monospace;
        letter-spacing: .28em;
        text-transform: uppercase;
        color: #f6a566;
        margin-bottom: 12px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(28px, 6vw, 44px);
      }
      p { margin: 0; color: rgba(248, 238, 229, .78); line-height: 1.5; }
    </style>
  </head>
  <body>
    <article class="card">
      <div class="eyebrow">Server Owned Widget</div>
      <h1>${title}</h1>
      <p>Generated as a reset-era artifact and rendered in a sandboxed iframe.</p>
    </article>
  </body>
</html>`;

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

type ResetWorkspaceShellProps = {
  initialManifest: RuntimeManifest;
  initialAgentPack: AgentInteropPack;
  initialWorkspace: WorkspaceSession;
  initialWorkspaces: WorkspaceSession[];
  initialExecutors: ExecutorSession[];
  initialTasks: TaskRun[];
  initialArtifacts: Artifact[];
  initialApprovals: ApprovalRequest[];
  initialPresence: PresenceMember[];
  initialModelProfiles: ModelProfile[];
  initialTraceEvents: Array<Record<string, unknown>>;
};

type WorkspaceSnapshotResponse = {
  workspace: WorkspaceSession;
  executors: ExecutorSession[];
  tasks: TaskRun[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  presence: PresenceMember[];
  traces: Array<Record<string, unknown>>;
  modelProfiles: ModelProfile[];
  manifest: RuntimeManifest;
};

type WorkspaceFilesResponse = {
  files: WorkspaceFileEntry[];
};

type WorkspaceFileResponse = {
  document: WorkspaceFileDocument;
};

type WorkspaceCatalogResponse = {
  workspaces: WorkspaceSession[];
};

type RuntimeManifestResponse = {
  manifest: RuntimeManifest;
  agentPack: AgentInteropPack;
};

export function ResetWorkspaceShell({
  initialManifest,
  initialAgentPack,
  initialWorkspace,
  initialWorkspaces,
  initialExecutors,
  initialTasks,
  initialArtifacts,
  initialApprovals,
  initialPresence,
  initialModelProfiles,
  initialTraceEvents,
}: ResetWorkspaceShellProps) {
  const router = useRouter();
  const [agentPack, setAgentPack] = useState(initialAgentPack);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [recentWorkspaces, setRecentWorkspaces] = useState(initialWorkspaces);
  const [executors, setExecutors] = useState(initialExecutors);
  const [tasks, setTasks] = useState(initialTasks);
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [presence, setPresence] = useState(initialPresence);
  const [modelProfiles] = useState(initialModelProfiles);
  const [traceEvents, setTraceEvents] = useState(initialTraceEvents);
  const [codeDraft, setCodeDraft] = useState(initialDraft);
  const [workspacePathInput, setWorkspacePathInput] = useState(initialWorkspace.workspacePath);
  const [taskPrompt, setTaskPrompt] = useState('Stage the Codex-native kernel, wire it to MCP, and surface the result in the workspace.');
  const [taskSummary, setTaskSummary] = useState('Codex workspace turn');
  const [widgetTitle, setWidgetTitle] = useState('Reset Brief');
  const [widgetHtml, setWidgetHtml] = useState(defaultWidgetHtml('Reset Brief'));
  const [traceQuery, setTraceQuery] = useState('');
  const [directoryPath, setDirectoryPath] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [activeDocument, setActiveDocument] = useState<WorkspaceFileDocument | null>(null);
  const [localIdentity, setLocalIdentity] = useState('');
  const [localPresenceLabel, setLocalPresenceLabel] = useState('Mission Control');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(initialTasks[0]?.id ?? null);
  const [roomTelemetry, setRoomTelemetry] = useState<{
    roomName: string | null;
    connectionState: string;
    participantCount: number;
    agentStatus: string;
    media: PresenceMember['media'];
  }>({
    roomName: null,
    connectionState: 'disconnected',
    participantCount: 0,
    agentStatus: 'not-requested',
    media: {
      audio: false,
      video: false,
      screen: false,
    },
  });
  const [isBusy, setIsBusy] = useState(false);
  const deferredTraceQuery = useDeferredValue(traceQuery);
  const eventSourceRef = useRef<EventSource | null>(null);
  const localIdentityRef = useRef('');
  const localDisplayNameRef = useRef('Mission Control');

  const latestWidgetArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.kind === 'widget_bundle') ?? null,
    [artifacts],
  );
  const latestPatchArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.kind === 'file_patch') ?? null,
    [artifacts],
  );
  const activeFileBreadcrumbs = useMemo(
    () => activeDocument?.path.split('/').filter(Boolean) ?? [],
    [activeDocument],
  );
  const formatCommand = (command: AgentInteropPack['commands'][keyof AgentInteropPack['commands']]) =>
    [command.command, ...command.args].join(' ');

  const refreshWorkspaceState = useEffectEvent(async (workspaceSessionId: string, activeQuery?: string) => {
    const snapshot = await requestJson<WorkspaceSnapshotResponse>(
      `/api/reset/workspaces/${encodeURIComponent(workspaceSessionId)}/state`,
    );
    const traces =
      activeQuery && activeQuery.trim()
        ? snapshot.traces.filter((event) => JSON.stringify(event).toLowerCase().includes(activeQuery.trim().toLowerCase()))
        : snapshot.traces;

    setWorkspace(snapshot.workspace);
    setExecutors(snapshot.executors);
    setTasks(snapshot.tasks);
    setArtifacts(snapshot.artifacts);
    setApprovals(snapshot.approvals);
    setPresence(snapshot.presence);
    setTraceEvents(traces);
    setActiveTaskId((current) => current ?? snapshot.tasks[0]?.id ?? null);
  });

  const refreshWorkspaceCatalog = useEffectEvent(async () => {
    const payload = await requestJson<WorkspaceCatalogResponse>('/api/reset/workspaces');
    setRecentWorkspaces(payload.workspaces.slice(0, 6));
  });

  const refreshAgentPack = useEffectEvent(async (workspaceSessionId: string) => {
    const search = new URLSearchParams({ workspaceSessionId });
    const payload = await requestJson<RuntimeManifestResponse>(`/api/reset/runtime-manifest?${search.toString()}`);
    setAgentPack(payload.agentPack);
  });

  const replaceWorkspaceUrl = useEffectEvent((workspaceSessionId: string) => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('workspace', workspaceSessionId);
    router.replace(`${nextUrl.pathname}?${nextUrl.searchParams.toString()}`, { scroll: false });
  });

  const activateWorkspace = useEffectEvent(async (nextWorkspace: WorkspaceSession) => {
    startTransition(() => {
      setWorkspace(nextWorkspace);
      setWorkspacePathInput(nextWorkspace.workspacePath);
      setActiveTaskId(null);
      setTraceEvents([]);
    });
    replaceWorkspaceUrl(nextWorkspace.id);
    await refreshWorkspaceState(nextWorkspace.id, deferredTraceQuery);
    await loadWorkspaceFiles(nextWorkspace.id, '');
    await loadDefaultWorkspaceFile(nextWorkspace.id);
    await refreshWorkspaceCatalog();
    await refreshAgentPack(nextWorkspace.id);
  });

  const loadWorkspaceFiles = useEffectEvent(async (workspaceSessionId: string, nextDirectoryPath = '') => {
    const search = new URLSearchParams();
    if (nextDirectoryPath) {
      search.set('directoryPath', nextDirectoryPath);
    }
    const query = search.toString();
    const payload = await requestJson<WorkspaceFilesResponse>(
      `/api/reset/workspaces/${encodeURIComponent(workspaceSessionId)}/files${query ? `?${query}` : ''}`,
    );
    setWorkspaceFiles(payload.files);
    setDirectoryPath(nextDirectoryPath);
  });

  const openWorkspaceFile = useEffectEvent(async (workspaceSessionId: string, filePath: string) => {
    const search = new URLSearchParams({ filePath });
    const payload = await requestJson<WorkspaceFileResponse>(
      `/api/reset/workspaces/${encodeURIComponent(workspaceSessionId)}/file?${search.toString()}`,
    );
    setActiveDocument(payload.document);
    setCodeDraft(payload.document.content);
  });

  const loadDefaultWorkspaceFile = useEffectEvent(async (workspaceSessionId: string) => {
    const preferredPaths = [
      'packages/ui/src/reset-workspace-shell.tsx',
      'src/app/page.tsx',
      'services/kernel/src/workspace-files.ts',
      'package.json',
    ];

    for (const filePath of preferredPaths) {
      try {
        await openWorkspaceFile(workspaceSessionId, filePath);
        return;
      } catch {
        // Try the next candidate.
      }
    }
  });

  const syncPresence = useEffectEvent(
    async (state: PresenceMember['state'], media?: Partial<PresenceMember['media']>) => {
      if (!localIdentityRef.current) return;
      const payload = await requestJson<{ presenceMember: PresenceMember }>('/api/reset/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId: workspace.id,
          identity: localIdentityRef.current,
          displayName: localDisplayNameRef.current,
          state,
          media: {
            audio: media?.audio ?? roomTelemetry.media.audio,
            video: media?.video ?? roomTelemetry.media.video,
            screen: media?.screen ?? roomTelemetry.media.screen,
          },
          metadata: {
            activeFilePath: activeDocument?.path ?? null,
            editorMode: 'reset_shell',
            draftSyncEnabled: false,
            roomName: roomTelemetry.roomName,
            roomConnectionState: roomTelemetry.connectionState,
            roomParticipantCount: roomTelemetry.participantCount,
            roomAgentStatus: roomTelemetry.agentStatus,
          },
        }),
      });

      setPresence((previous) =>
        [payload.presenceMember, ...previous.filter((member) => member.id !== payload.presenceMember.id)].sort(
          (left, right) => right.updatedAt.localeCompare(left.updatedAt),
        ),
      );
    },
  );

  useEffect(() => {
    void refreshWorkspaceState(workspace.id, deferredTraceQuery);
  }, [deferredTraceQuery, refreshWorkspaceState, workspace.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedIdentity = window.sessionStorage.getItem('present:reset:identity');
    const identity = storedIdentity ?? `operator-${Math.random().toString(36).slice(2, 10)}`;
    const storedName = window.sessionStorage.getItem('present:reset:name');
    const displayName = storedName ?? `Mission ${identity.slice(-4).toUpperCase()}`;

    window.sessionStorage.setItem('present:reset:identity', identity);
    window.sessionStorage.setItem('present:reset:name', displayName);
    localIdentityRef.current = identity;
    localDisplayNameRef.current = displayName;
    setLocalIdentity(identity);
    setLocalPresenceLabel(displayName);
  }, []);

  useEffect(() => {
    void loadWorkspaceFiles(workspace.id, '');
    void loadDefaultWorkspaceFile(workspace.id);
  }, [loadDefaultWorkspaceFile, loadWorkspaceFiles, workspace.id]);

  useEffect(() => {
    setWorkspacePathInput(workspace.workspacePath);
  }, [workspace.workspacePath]);

  useEffect(() => {
    if (!localIdentity) return;

    void syncPresence('connected');

    const visibilityHandler = () => {
      void syncPresence(document.hidden ? 'away' : 'connected');
    };
    const heartbeat = window.setInterval(() => {
      void syncPresence(document.hidden ? 'idle' : 'connected');
      void refreshWorkspaceState(workspace.id, deferredTraceQuery);
    }, 15000);
    const cleanup = () => {
      void requestJson('/api/reset/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId: workspace.id,
          identity: localIdentityRef.current,
          state: 'offline',
        }),
      }).catch(() => {
        // Best effort cleanup only.
      });
    };

    window.addEventListener('visibilitychange', visibilityHandler);
    window.addEventListener('pagehide', cleanup);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener('visibilitychange', visibilityHandler);
      window.removeEventListener('pagehide', cleanup);
      cleanup();
    };
  }, [deferredTraceQuery, localIdentity, refreshWorkspaceState, roomTelemetry, syncPresence, workspace.id]);

  useEffect(() => {
    if (!localIdentity) return;
    void syncPresence(document.hidden ? 'idle' : 'connected');
  }, [activeDocument?.path, localIdentity, syncPresence]);

  useEffect(() => {
    const currentTaskId = activeTaskId ?? tasks[0]?.id ?? null;
    const currentTask = tasks.find((task) => task.id === currentTaskId) ?? null;

    if (!currentTaskId || !currentTask || !['queued', 'running'].includes(currentTask.status)) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    eventSourceRef.current?.close();
    const eventSource = new EventSource(`/api/reset/tasks/${encodeURIComponent(currentTaskId)}/events`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('task', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as TaskRun;
      setTasks((previous) =>
        [payload, ...previous.filter((task) => task.id !== payload.id)].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
      );
    });

    eventSource.addEventListener('trace', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
      setTraceEvents((previous) => [payload, ...previous.filter((entry) => entry['id'] !== payload['id'])]);
    });

    eventSource.addEventListener('done', () => {
      eventSource.close();
      eventSourceRef.current = null;
      void refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });

    eventSource.onerror = () => {
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
    };

    return () => {
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
    };
  }, [activeTaskId, deferredTraceQuery, refreshWorkspaceState, tasks, workspace.id]);

  const runAction = async (action: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await action();
    } finally {
      setIsBusy(false);
    }
  };

  const openWorkspace = async () => {
    await runAction(async () => {
      const result = await requestJson<{ workspace: WorkspaceSession }>('/api/reset/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspacePathInput,
          branch: workspace.branch,
          title: 'PRESENT Reset Workspace',
        }),
      });
      await activateWorkspace(result.workspace);
    });
  };

  const resumeWorkspace = async (workspaceSession: WorkspaceSession) => {
    await runAction(async () => {
      const result = await requestJson<{ workspace: WorkspaceSession }>('/api/reset/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: workspaceSession.workspacePath,
          branch: workspaceSession.branch,
          title: workspaceSession.title,
        }),
      });
      await activateWorkspace(result.workspace);
    });
  };

  const registerLocalExecutor = async () => {
    await runAction(async () => {
      const result = await requestJson<{ executorSession: ExecutorSession }>('/api/reset/executors/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId: workspace.id,
          identity: 'local-companion',
          kind: 'local_companion',
          authMode: 'chatgpt',
          codexBaseUrl: initialManifest.codex.appServerBaseUrl,
          capabilities: ['code_edit', 'code_review', 'canvas_edit', 'widget_render', 'room_presence', 'mcp_server'],
        }),
      });
      startTransition(() => {
        setExecutors((previous) =>
          [result.executorSession, ...previous.filter((executor) => executor.id !== result.executorSession.id)].sort(
            (left, right) => right.updatedAt.localeCompare(left.updatedAt),
          ),
        );
      });
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });
  };

  const startCodexTask = async () => {
    await runAction(async () => {
      const result = await requestJson<{ taskRun: TaskRun }>('/api/reset/turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId: workspace.id,
          summary: taskSummary,
          prompt: taskPrompt,
          executorSessionId: executors[0]?.id,
        }),
      });
      setActiveTaskId(result.taskRun.id);
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });
  };

  const queueCanvasTask = async () => {
    await runAction(async () => {
      const result = await requestJson<{ taskRun: TaskRun }>('/api/reset/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId: workspace.id,
          taskType: 'canvas.run',
          summary: 'Canvas task',
          prompt: taskPrompt,
        }),
      });
      setActiveTaskId(result.taskRun.id);
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });
  };

  const createWidgetArtifact = async () => {
    await runAction(async () => {
      await requestJson('/api/reset/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId: workspace.id,
          kind: 'widget_bundle',
          title: widgetTitle,
          mimeType: 'text/html',
          content: widgetHtml,
        }),
      });
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });
  };

  const requestApproval = async () => {
    const traceId =
      tasks[0]?.traceId ??
      approvals[0]?.traceId ??
      String(traceEvents[0]?.['traceId'] ?? 'trace_pending');
    await runAction(async () => {
      await requestJson('/api/reset/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceSessionId: workspace.id,
          traceId,
          kind: 'git_action',
          title: 'Approve reset branch write',
          detail: 'Allow the local companion to write files and stage a reviewable patch set for the reset branch.',
          requestedBy: 'mission-control',
        }),
      });
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });
  };

  const resolveApproval = async (approvalRequestId: string, state: 'approved' | 'rejected') => {
    await runAction(async () => {
      await requestJson('/api/reset/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvalRequestId,
          state,
          resolvedBy: 'mission-control',
        }),
      });
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });
  };

  const applyPatchArtifact = async (artifactId: string) => {
    await runAction(async () => {
      await requestJson(`/api/reset/artifacts/${encodeURIComponent(artifactId)}/apply`, {
        method: 'POST',
      });
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
      if (activeDocument) {
        await openWorkspaceFile(workspace.id, activeDocument.path);
      }
    });
  };

  const saveActiveFile = async () => {
    if (!activeDocument) return;
    await runAction(async () => {
      const payload = await requestJson<WorkspaceFileResponse>(
        `/api/reset/workspaces/${encodeURIComponent(workspace.id)}/file`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: activeDocument.path,
            content: codeDraft,
          }),
        },
      );
      setActiveDocument(payload.document);
      setCodeDraft(payload.document.content);
      await loadWorkspaceFiles(workspace.id, directoryPath);
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });
  };

  const createPatchArtifact = async () => {
    if (!activeDocument) return;
    const traceId =
      tasks[0]?.traceId ??
      approvals[0]?.traceId ??
      String(traceEvents[0]?.['traceId'] ?? 'trace_pending');

    await runAction(async () => {
      await requestJson(`/api/reset/workspaces/${encodeURIComponent(workspace.id)}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: activeDocument.path,
          nextContent: codeDraft,
          traceId,
          title: `Patch ${activeDocument.path}`,
        }),
      });
      await refreshWorkspaceState(workspace.id, deferredTraceQuery);
    });
  };

  const navigateDirectory = async (nextDirectoryPath: string) => {
    await runAction(async () => {
      await loadWorkspaceFiles(workspace.id, nextDirectoryPath);
    });
  };

  return (
    <div className="reset-shell">
      <div className="reset-shell__backdrop" />
      <header className="reset-hero">
        <div>
          <div className="reset-eyebrow">PRESENT RESET / CODEX-NATIVE WORKSPACE</div>
          <h1>Editorial mission control for code, canvas, rooms, widgets, and external agents.</h1>
          <p>
            The legacy canvas runtime is still in the repo, but the root product now runs on reset-era
            kernel contracts, Codex app-server assumptions, and a server-owned MCP boundary.
          </p>
        </div>
        <div className="reset-hero__badges">
          <span>Dual Client</span>
          <span>Small Teams</span>
          <span>{initialManifest.codex.recommendedModels.join(' / ')}</span>
        </div>
      </header>

      <section className="reset-topline">
        <article className="reset-panel">
          <label className="reset-field-label">Workspace Path</label>
          <div className="reset-inline-form">
            <input
              value={workspacePathInput}
              onChange={(event) => setWorkspacePathInput(event.target.value)}
              className="reset-input"
            />
            <button type="button" onClick={openWorkspace} className="reset-button" disabled={isBusy}>
              Open Workspace
            </button>
          </div>
          <div className="reset-meta-grid">
            <div>
              <span>Workspace</span>
              <strong>{workspace.title}</strong>
            </div>
            <div>
              <span>Branch</span>
              <strong>{workspace.branch}</strong>
            </div>
            <div>
              <span>Executor</span>
              <strong>{workspace.activeExecutorSessionId ?? 'none'}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{workspace.state}</strong>
            </div>
          </div>
          <div className="reset-section-heading">Recent Sessions</div>
          <div className="reset-list">
            {recentWorkspaces.map((recentWorkspace) => (
              <article key={recentWorkspace.id} className="reset-list-card">
                <div className="reset-list-card__eyebrow">
                  {recentWorkspace.id === workspace.id ? 'Current Session' : 'Recovered Session'}
                </div>
                <strong>{recentWorkspace.title}</strong>
                <p className="reset-list-card__path">{recentWorkspace.workspacePath}</p>
                <div className="reset-list-card__footer">
                  <span>{recentWorkspace.branch}</span>
                  <button
                    type="button"
                    onClick={() => void resumeWorkspace(recentWorkspace)}
                    className="reset-button reset-button--ghost"
                    disabled={isBusy || recentWorkspace.id === workspace.id}
                  >
                    {recentWorkspace.id === workspace.id ? 'Active' : 'Resume'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="reset-panel">
          <label className="reset-field-label">Codex Task</label>
          <input
            className="reset-input"
            value={taskSummary}
            onChange={(event) => setTaskSummary(event.target.value)}
          />
          <textarea
            className="reset-textarea reset-textarea--compact"
            value={taskPrompt}
            onChange={(event) => setTaskPrompt(event.target.value)}
          />
          <div className="reset-inline-actions">
            <button type="button" onClick={registerLocalExecutor} className="reset-button reset-button--secondary" disabled={isBusy}>
              Register Local Companion
            </button>
            <button type="button" onClick={startCodexTask} className="reset-button" disabled={isBusy}>
              Start Codex Turn
            </button>
            <button type="button" onClick={queueCanvasTask} className="reset-button reset-button--ghost" disabled={isBusy}>
              Queue Canvas Task
            </button>
          </div>
        </article>
      </section>

      <section className="reset-main-grid">
        <article className="reset-panel reset-panel--editor">
          <div className="reset-panel__header">
            <div>
              <div className="reset-panel__eyebrow">Code</div>
              <h2>Workspace Pad</h2>
            </div>
            <div className="reset-panel__microcopy">
              The reset shell now reads the real workspace, stages patch artifacts, and can write directly for local iteration.
            </div>
          </div>
          <div className="reset-editor-layout">
            <aside className="reset-file-browser">
              <div className="reset-file-browser__header">
                <div className="reset-frame-title">Directory</div>
                <strong>{directoryPath || '.'}</strong>
              </div>
              <div className="reset-inline-actions">
                <button type="button" onClick={() => navigateDirectory('')} className="reset-button reset-button--ghost" disabled={isBusy}>
                  Root
                </button>
                <button
                  type="button"
                  onClick={() => navigateDirectory(directoryPath.split('/').slice(0, -1).join('/'))}
                  className="reset-button reset-button--ghost"
                  disabled={isBusy || !directoryPath}
                >
                  Up
                </button>
              </div>
              <div className="reset-file-list">
                {workspaceFiles.length === 0 ? <div className="reset-empty">No files loaded.</div> : null}
                {workspaceFiles.map((entry) => (
                  <button
                    type="button"
                    key={entry.path}
                    className={`reset-file-entry${activeDocument?.path === entry.path ? ' reset-file-entry--active' : ''}`}
                    onClick={() =>
                      entry.kind === 'directory'
                        ? void navigateDirectory(entry.path)
                        : void openWorkspaceFile(workspace.id, entry.path)
                    }
                  >
                    <span>{entry.kind === 'directory' ? 'DIR' : entry.language ?? 'FILE'}</span>
                    <strong>{entry.name}</strong>
                  </button>
                ))}
              </div>
            </aside>
            <div className="reset-editor-pane">
              <div className="reset-editor-pane__header">
                <div>
                  <div className="reset-frame-title">Active File</div>
                  <strong>{activeDocument?.path ?? 'Select a file'}</strong>
                  {activeFileBreadcrumbs.length > 0 ? (
                    <p>{activeFileBreadcrumbs.join(' / ')}</p>
                  ) : (
                    <p>Browse the workspace tree and load a real file into the editor.</p>
                  )}
                  <p>
                    Editing the real workspace file directly from mission control as {localPresenceLabel}.
                  </p>
                </div>
                <div className="reset-inline-actions">
                  <button
                    type="button"
                    onClick={() => (activeDocument ? void openWorkspaceFile(workspace.id, activeDocument.path) : undefined)}
                    className="reset-button reset-button--ghost"
                    disabled={isBusy || !activeDocument}
                  >
                    Reload
                  </button>
                  <button type="button" onClick={saveActiveFile} className="reset-button reset-button--secondary" disabled={isBusy || !activeDocument}>
                    Save File
                  </button>
                  <button type="button" onClick={createPatchArtifact} className="reset-button" disabled={isBusy || !activeDocument}>
                    Create Patch Artifact
                  </button>
                </div>
              </div>
              <textarea
                className="reset-code-editor"
                value={codeDraft}
                onChange={(event) => setCodeDraft(event.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        </article>

        <article className="reset-panel reset-panel--canvas">
          <div className="reset-panel__header">
            <div>
              <div className="reset-panel__eyebrow">Canvas / Widget Rail</div>
              <h2>Server-Owned Preview</h2>
            </div>
            <div className="reset-panel__microcopy">Reset-native TLDraw collaboration, widget artifacts, and patch review now live in the shell without ceding `/` back to the archived canvas route.</div>
          </div>
          <div className="reset-frame-shell">
            <ResetCollaborationSurface
              workspaceSessionId={workspace.id}
              operatorLabel={localPresenceLabel}
              onTelemetryChange={(telemetry) => {
                setRoomTelemetry({
                  roomName: telemetry.roomName,
                  connectionState: telemetry.connectionState,
                  participantCount: telemetry.participantCount,
                  agentStatus: telemetry.agentStatus,
                  media: telemetry.media,
                });
              }}
            />
          </div>
          <div className="reset-widget-form">
            <input
              className="reset-input"
              value={widgetTitle}
              onChange={(event) => {
                const nextTitle = event.target.value;
                setWidgetTitle(nextTitle);
                if (!latestWidgetArtifact) {
                  setWidgetHtml(defaultWidgetHtml(nextTitle));
                }
              }}
            />
            <textarea
              className="reset-textarea"
              value={widgetHtml}
              onChange={(event) => setWidgetHtml(event.target.value)}
            />
            <div className="reset-inline-actions">
              <button type="button" onClick={createWidgetArtifact} className="reset-button" disabled={isBusy}>
                Publish Widget Artifact
              </button>
              <button type="button" onClick={requestApproval} className="reset-button reset-button--ghost" disabled={isBusy}>
                Request Approval
              </button>
            </div>
          </div>
          <ArtifactPreviewFrame
            title={latestWidgetArtifact?.title ?? widgetTitle}
            html={latestWidgetArtifact?.content || widgetHtml}
          />
          <div className="reset-frame-shell">
            <div className="reset-frame-title">Latest Patch Artifact</div>
            {latestPatchArtifact ? (
              <>
                <pre className="reset-diff-view">{latestPatchArtifact.content}</pre>
                <div className="reset-inline-actions">
                  <button type="button" onClick={() => applyPatchArtifact(latestPatchArtifact.id)} className="reset-button reset-button--ghost" disabled={isBusy}>
                    Apply Latest Patch
                  </button>
                </div>
              </>
            ) : (
              <div className="reset-empty">No patch artifacts yet.</div>
            )}
          </div>
        </article>

        <aside className="reset-sidebar">
          <article className="reset-panel reset-panel--stack">
            <div className="reset-panel__header">
              <div>
                <div className="reset-panel__eyebrow">Trace</div>
                <h2>Mission Ledger</h2>
              </div>
              <input
                className="reset-input reset-input--micro"
                placeholder="Search traces"
                value={traceQuery}
                onChange={(event) => setTraceQuery(event.target.value)}
              />
            </div>
            <div className="reset-list">
              {traceEvents.length === 0 ? <div className="reset-empty">No trace events yet.</div> : null}
              {traceEvents.slice(0, 8).map((event, index) => (
                <article className="reset-list-card" key={`${String(event['id'] ?? index)}`}>
                  <div className="reset-list-card__eyebrow">{String(event['type'] ?? 'event')}</div>
                  <strong>{String(event['summary'] ?? event['title'] ?? event['toolName'] ?? 'Kernel event')}</strong>
                  <p>{String(event['detail'] ?? event['command'] ?? event['approvalRequestId'] ?? '')}</p>
                </article>
              ))}
            </div>
          </article>

          <article className="reset-panel reset-panel--stack">
            <div className="reset-panel__header">
              <div>
                <div className="reset-panel__eyebrow">Approvals</div>
                <h2>Risk Gate</h2>
              </div>
            </div>
            <div className="reset-list">
              {approvals.length === 0 ? <div className="reset-empty">No approval requests.</div> : null}
              {approvals.slice(0, 5).map((approval) => (
                <article className="reset-list-card" key={approval.id}>
                  <div className="reset-list-card__eyebrow">{approval.kind}</div>
                  <strong>{approval.title}</strong>
                  <p>{approval.detail}</p>
                  <span className={`reset-pill reset-pill--${approval.state}`}>{approval.state}</span>
                  {approval.state === 'pending' ? (
                    <div className="reset-inline-actions">
                      <button
                        type="button"
                        onClick={() => resolveApproval(approval.id, 'approved')}
                        className="reset-button reset-button--ghost"
                        disabled={isBusy}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveApproval(approval.id, 'rejected')}
                        className="reset-button reset-button--secondary"
                        disabled={isBusy}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </article>
        </aside>
      </section>

      <section className="reset-bottom-grid">
        <article className="reset-panel">
          <div className="reset-panel__header">
            <div>
              <div className="reset-panel__eyebrow">Tasks</div>
              <h2>Queued Work</h2>
            </div>
          </div>
          <div className="reset-list reset-list--horizontal">
            {tasks.length === 0 ? <div className="reset-empty">No tasks queued.</div> : null}
            {tasks.slice(0, 5).map((task) => (
              <article
                className="reset-list-card"
                key={task.id}
                onClick={() => setActiveTaskId(task.id)}
                role="button"
                tabIndex={0}
              >
                <div className="reset-list-card__eyebrow">{task.taskType}</div>
                <strong>{task.summary}</strong>
                <p>{task.status}</p>
              </article>
            ))}
          </div>
        </article>

        <article className="reset-panel">
          <div className="reset-panel__header">
            <div>
              <div className="reset-panel__eyebrow">Models</div>
              <h2>Role Policy</h2>
            </div>
          </div>
          <div className="reset-profile-grid">
            {modelProfiles.map((profile) => (
              <article className="reset-profile-card" key={profile.id}>
                <div className="reset-list-card__eyebrow">{profile.role}</div>
                <strong>{profile.model}</strong>
                <p>{profile.label}</p>
              </article>
            ))}
          </div>
        </article>

        <article className="reset-panel">
          <div className="reset-panel__header">
            <div>
              <div className="reset-panel__eyebrow">BYO Agent</div>
              <h2>OpenClaw + MCP Pack</h2>
            </div>
            <div className="reset-panel__microcopy">
              Machine-readable entry points for external agents and local operator tooling.
            </div>
          </div>
          <div className="reset-list">
            <article className="reset-list-card">
              <div className="reset-list-card__eyebrow">Recommended Clients</div>
              <strong>{agentPack.recommendedClients.join(' / ')}</strong>
              <p>{agentPack.notes[0] ?? 'Use the local companion for subscription-backed Codex auth.'}</p>
            </article>
          </div>
          <div className="reset-command-grid">
            <article className="reset-list-card">
              <div className="reset-list-card__eyebrow">MCP Server</div>
              <strong>{agentPack.mcpServer.name}</strong>
              <pre className="reset-command-block">{`${agentPack.mcpServer.command} ${agentPack.mcpServer.args.join(' ')}`}</pre>
            </article>
            <article className="reset-list-card">
              <div className="reset-list-card__eyebrow">Reset Open</div>
              <strong>CLI workspace attach</strong>
              <pre className="reset-command-block">{formatCommand(agentPack.commands.openWorkspace)}</pre>
            </article>
            <article className="reset-list-card">
              <div className="reset-list-card__eyebrow">Reset Turn</div>
              <strong>Prompt through the kernel</strong>
              <pre className="reset-command-block">{formatCommand(agentPack.commands.startTurn)}</pre>
            </article>
            <article className="reset-list-card">
              <div className="reset-list-card__eyebrow">Manifest</div>
              <strong>Inspect runtime + interop</strong>
              <pre className="reset-command-block">{formatCommand(agentPack.commands.printManifest)}</pre>
            </article>
          </div>
        </article>

        <article className="reset-panel">
          <div className="reset-panel__header">
            <div>
              <div className="reset-panel__eyebrow">Control Plane</div>
              <h2>Executors + Presence</h2>
            </div>
          </div>
          <div className="reset-room-grid">
            <div className="reset-room-card">
              <span>Executors</span>
              <strong>{executors.length}</strong>
            </div>
            <div className="reset-room-card">
              <span>Presence</span>
              <strong>{presence.length}</strong>
            </div>
            <div className="reset-room-card">
              <span>MCP</span>
              <strong>{initialManifest.mcp.serverName}</strong>
            </div>
            <div className="reset-room-card">
              <span>Clients</span>
              <strong>{initialManifest.collaboration.dualClient ? 'web + desktop' : 'single'}</strong>
            </div>
          </div>
          <div className="reset-list-card">
            <div className="reset-list-card__eyebrow">Room State</div>
            <strong>{roomTelemetry.roomName ?? 'no room selected'}</strong>
            <p>
              {roomTelemetry.connectionState} / {roomTelemetry.participantCount} participant
              {roomTelemetry.participantCount === 1 ? '' : 's'} / agent {roomTelemetry.agentStatus}
            </p>
          </div>
          <div className="reset-list">
            {presence.slice(0, 4).map((member) => (
              <article className="reset-list-card" key={member.id}>
                <div className="reset-list-card__eyebrow">{member.state}</div>
                <strong>{member.displayName}</strong>
                <p>
                  {member.metadata['activeFilePath']
                    ? String(member.metadata['activeFilePath'])
                    : member.metadata['roomName']
                      ? `Room ${String(member.metadata['roomName'])}`
                      : 'No active file'}
                </p>
              </article>
            ))}
            {executors.slice(0, 3).map((executor) => (
              <article className="reset-list-card" key={executor.id}>
                <div className="reset-list-card__eyebrow">{executor.kind}</div>
                <strong>{executor.identity}</strong>
                <p>{executor.state}</p>
              </article>
            ))}
            {artifacts.filter((artifact) => artifact.kind === 'file_patch').slice(0, 2).map((artifact) => (
              <article className="reset-list-card" key={artifact.id}>
                <div className="reset-list-card__eyebrow">file_patch</div>
                <strong>{artifact.title}</strong>
                <p>{artifact.metadata['filePath'] ? String(artifact.metadata['filePath']) : artifact.mimeType}</p>
                <button
                  type="button"
                  onClick={() => applyPatchArtifact(artifact.id)}
                  className="reset-button reset-button--ghost"
                  disabled={isBusy}
                >
                  Apply Patch
                </button>
              </article>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
