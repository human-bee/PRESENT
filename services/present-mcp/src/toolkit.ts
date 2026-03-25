import { z } from 'zod';
import {
  applyArtifactPatch,
  buildCanvasRuntimeSurface,
  createApprovalRequest,
  createArtifact,
  createWorkspacePatchArtifact,
  getArtifact,
  getWorkspaceSession,
  listApprovalRequests,
  listArtifacts,
  listExecutorSessions,
  listPresenceMembers,
  listTaskRuns,
  listTraceEvents,
  listWorkspaceFiles,
  listWorkspaceSessions,
  openWorkspaceSession,
  readWorkspaceFile,
  resolveApprovalRequest,
  resolveKernelModelProfiles,
  searchTraceEvents,
  enqueueTaskRun,
} from '@present/kernel';
import { startCodexTurn } from '@present/codex-adapter';

function resolveScopedWorkspaceContext() {
  const scopedWorkspaceSessionId = process.env.PRESENT_RESET_WORKSPACE_SESSION_ID?.trim() || null;
  if (scopedWorkspaceSessionId) {
    const workspace = getWorkspaceSession(scopedWorkspaceSessionId);
    return {
      workspace,
      error: workspace ? null : `Configured workspace session ${scopedWorkspaceSessionId} was not found`,
    };
  }

  const scopedWorkspacePath = process.env.PRESENT_RESET_WORKSPACE_PATH?.trim() || null;
  if (scopedWorkspacePath) {
    const workspace = listWorkspaceSessions().find((candidate) => candidate.workspacePath === scopedWorkspacePath) ?? null;
    return {
      workspace,
      error: workspace ? null : `Configured workspace path ${scopedWorkspacePath} was not found`,
    };
  }

  return {
    workspace: null,
    error: null,
  };
}

function requireWorkspaceAccess(workspaceSessionId: string) {
  const scoped = resolveScopedWorkspaceContext();
  if (scoped.error) {
    throw new Error(scoped.error);
  }

  if (scoped.workspace) {
    if (scoped.workspace.id !== workspaceSessionId) {
      throw new Error('Workspace session is outside the current MCP scope');
    }
    return scoped.workspace;
  }

  const workspace = getWorkspaceSession(workspaceSessionId);
  if (!workspace) {
    throw new Error('Workspace session not found');
  }
  return workspace;
}

function requireArtifactAccess(artifactId: string) {
  const artifact = getArtifact(artifactId);
  if (!artifact) {
    throw new Error('Artifact not found');
  }
  requireWorkspaceAccess(artifact.workspaceSessionId);
  return artifact;
}

function requireApprovalAccess(approvalRequestId: string) {
  const approval = listApprovalRequests().find((entry) => entry.id === approvalRequestId) ?? null;
  if (!approval) {
    throw new Error('Approval request not found');
  }
  requireWorkspaceAccess(approval.workspaceSessionId);
  return approval;
}

export const presentMcpTools = {
  workspaceOpen: {
    name: 'workspace.open',
    description: 'Open or create a PRESENT reset workspace session.',
    schema: {
      workspacePath: z.string().min(1),
      branch: z.string().optional(),
      title: z.string().optional(),
    },
    async run(input: { workspacePath: string; branch?: string; title?: string }) {
      const scoped = resolveScopedWorkspaceContext();
      if (scoped.error) {
        throw new Error(scoped.error);
      }
      if (scoped.workspace) {
        if (scoped.workspace.workspacePath !== input.workspacePath) {
          throw new Error('Workspace session is outside the current MCP scope');
        }
        return { workspace: scoped.workspace };
      }
      return { workspace: openWorkspaceSession(input) };
    },
  },
  workspaceFiles: {
    name: 'workspace.files',
    description: 'List files in a PRESENT reset workspace directory.',
    schema: {
      workspaceSessionId: z.string().min(1),
      directoryPath: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    async run(input: { workspaceSessionId: string; directoryPath?: string; limit?: number }) {
      requireWorkspaceAccess(input.workspaceSessionId);
      return {
        files: listWorkspaceFiles({
          workspaceSessionId: input.workspaceSessionId,
          directoryPath: input.directoryPath,
          limit: input.limit,
        }),
      };
    },
  },
  workspaceReadFile: {
    name: 'workspace.readFile',
    description: 'Read a file from a PRESENT reset workspace.',
    schema: {
      workspaceSessionId: z.string().min(1),
      filePath: z.string().min(1),
    },
    async run(input: { workspaceSessionId: string; filePath: string }) {
      requireWorkspaceAccess(input.workspaceSessionId);
      return {
        document: readWorkspaceFile({
          workspaceSessionId: input.workspaceSessionId,
          filePath: input.filePath,
        }),
      };
    },
  },
  workspaceCreatePatch: {
    name: 'workspace.createPatch',
    description: 'Create a server-owned file patch artifact from edited file content.',
    schema: {
      workspaceSessionId: z.string().min(1),
      filePath: z.string().min(1),
      nextContent: z.string(),
      traceId: z.string().optional(),
      title: z.string().optional(),
    },
    async run(input: {
      workspaceSessionId: string;
      filePath: string;
      nextContent: string;
      traceId?: string;
      title?: string;
    }) {
      requireWorkspaceAccess(input.workspaceSessionId);
      return {
        artifact: createWorkspacePatchArtifact({
          workspaceSessionId: input.workspaceSessionId,
          filePath: input.filePath,
          nextContent: input.nextContent,
          traceId: input.traceId,
          title: input.title,
        }),
      };
    },
  },
  taskEnqueue: {
    name: 'task.enqueue',
    description: 'Queue a kernel task run for a workspace session.',
    schema: {
      workspaceSessionId: z.string().min(1),
      summary: z.string().min(1),
      taskType: z.string().min(1),
      prompt: z.string().optional(),
    },
    async run(input: {
      workspaceSessionId: string;
      summary: string;
      taskType: string;
      prompt?: string;
    }) {
      requireWorkspaceAccess(input.workspaceSessionId);
      return {
        taskRun: await enqueueTaskRun({
          workspaceSessionId: input.workspaceSessionId,
          summary: input.summary,
          taskType: input.taskType,
          params: input.prompt ? { prompt: input.prompt } : {},
        }),
      };
    },
  },
  turnStart: {
    name: 'turn.start',
    description: 'Start a Codex-backed reset turn for a workspace.',
    schema: {
      workspaceSessionId: z.string().min(1),
      prompt: z.string().min(1),
      summary: z.string().min(1),
      executorSessionId: z.string().optional(),
      model: z.string().optional(),
    },
    async run(input: {
      workspaceSessionId: string;
      prompt: string;
      summary: string;
      executorSessionId?: string;
      model?: string;
    }) {
      requireWorkspaceAccess(input.workspaceSessionId);
      return {
        taskRun: await startCodexTurn({
          workspaceSessionId: input.workspaceSessionId,
          prompt: input.prompt,
          summary: input.summary,
          executorSessionId: input.executorSessionId,
          model: input.model,
        }),
      };
    },
  },
  canvasRun: {
    name: 'canvas.run',
    description: 'Queue a server-owned canvas task for a workspace.',
    schema: {
      workspaceSessionId: z.string().min(1),
      prompt: z.string().min(1),
      summary: z.string().optional(),
    },
    async run(input: { workspaceSessionId: string; prompt: string; summary?: string }) {
      requireWorkspaceAccess(input.workspaceSessionId);
      return {
        taskRun: await enqueueTaskRun({
          workspaceSessionId: input.workspaceSessionId,
          summary: input.summary ?? 'Canvas task',
          taskType: 'canvas.run',
          params: { prompt: input.prompt },
        }),
      };
    },
  },
  widgetCreate: {
    name: 'widget.create',
    description: 'Create a server-owned iframe widget artifact.',
    schema: {
      workspaceSessionId: z.string().min(1),
      title: z.string().min(1),
      html: z.string().min(1),
    },
    async run(input: { workspaceSessionId: string; title: string; html: string }) {
      requireWorkspaceAccess(input.workspaceSessionId);
      return {
        artifact: createArtifact({
          workspaceSessionId: input.workspaceSessionId,
          kind: 'widget_bundle',
          title: input.title,
          mimeType: 'text/html',
          content: input.html,
        }),
      };
    },
  },
  artifactGet: {
    name: 'artifact.get',
    description: 'Read a reset artifact by id.',
    schema: {
      artifactId: z.string().min(1),
    },
    async run(input: { artifactId: string }) {
      return { artifact: requireArtifactAccess(input.artifactId) };
    },
  },
  artifactApplyPatch: {
    name: 'artifact.applyPatch',
    description: 'Apply an approved reset file patch artifact into the workspace via git apply.',
    schema: {
      artifactId: z.string().min(1),
      approvalRequestId: z.string().min(1),
      resolvedBy: z.string().min(1).optional(),
    },
    async run(input: { artifactId: string; approvalRequestId: string; resolvedBy?: string }) {
      const artifact = requireArtifactAccess(input.artifactId);
      const approval = requireApprovalAccess(input.approvalRequestId);
      if (approval.workspaceSessionId !== artifact.workspaceSessionId) {
        throw new Error('Approval request does not match artifact workspace');
      }
      return {
        artifact: applyArtifactPatch({
          artifactId: artifact.id,
          approvalRequestId: approval.id,
          resolvedBy: input.resolvedBy ?? 'present-mcp',
        }),
      };
    },
  },
  approvalRequest: {
    name: 'approval.request',
    description: 'Create an approval request tied to a workspace trace.',
    schema: {
      workspaceSessionId: z.string().min(1),
      traceId: z.string().min(1),
      kind: z.enum(['file_write', 'shell_exec', 'network_access', 'git_action', 'tool_escalation']),
      title: z.string().min(1),
      detail: z.string().min(1),
      requestedBy: z.string().min(1),
    },
    async run(input: {
      workspaceSessionId: string;
      traceId: string;
      kind: 'file_write' | 'shell_exec' | 'network_access' | 'git_action' | 'tool_escalation';
      title: string;
      detail: string;
      requestedBy: string;
    }) {
      requireWorkspaceAccess(input.workspaceSessionId);
      return { approval: createApprovalRequest(input) };
    },
  },
  approvalResolve: {
    name: 'approval.resolve',
    description: 'Resolve a pending approval request.',
    schema: {
      approvalRequestId: z.string().min(1),
      state: z.enum(['approved', 'rejected', 'expired']),
      resolvedBy: z.string().min(1),
    },
    async run(input: { approvalRequestId: string; state: 'approved' | 'rejected' | 'expired'; resolvedBy: string }) {
      requireApprovalAccess(input.approvalRequestId);
      const approval = resolveApprovalRequest(input);
      if (!approval) {
        throw new Error('Approval request not found');
      }
      return { approval };
    },
  },
  traceSearch: {
    name: 'trace.search',
    description: 'Search reset trace events.',
    schema: {
      query: z.string().default(''),
    },
    async run(input: { query?: string }) {
      const scoped = resolveScopedWorkspaceContext();
      if (scoped.error) {
        throw new Error(scoped.error);
      }
      const events = searchTraceEvents(input.query ?? '');
      return {
        events: scoped.workspace
          ? events.filter((event) => event.workspaceSessionId === scoped.workspace.id)
          : events,
      };
    },
  },
};

export async function listPresentMcpResources() {
  const modelProfiles = await resolveKernelModelProfiles();
  const scoped = resolveScopedWorkspaceContext();
  const workspace = scoped.error ? null : scoped.workspace;
  const workspaces = scoped.error ? [] : workspace ? [workspace] : listWorkspaceSessions();
  const executors = scoped.error ? [] : workspace ? listExecutorSessions(workspace.id) : listExecutorSessions();
  const tasks = scoped.error ? [] : workspace ? listTaskRuns(workspace.id) : listTaskRuns();
  const artifacts = scoped.error ? [] : workspace ? listArtifacts(workspace.id) : listArtifacts();
  const approvals = scoped.error ? [] : workspace ? listApprovalRequests(workspace.id) : listApprovalRequests();
  const presence = scoped.error ? [] : workspace ? listPresenceMembers(workspace.id) : listPresenceMembers();
  const traces = scoped.error
    ? []
    : workspace
      ? listTraceEvents().filter((event) => event.workspaceSessionId === workspace.id)
      : listTraceEvents();
  const latestPatchArtifact = artifacts.find((artifact) => artifact.kind === 'file_patch') ?? null;
  const runtimeSurface = buildCanvasRuntimeSurface(workspace);

  return [
    {
      uri: 'present://runtime/manifest',
      name: 'runtime.manifest',
      mimeType: 'application/json',
      text: JSON.stringify(runtimeSurface.manifest, null, 2),
    },
    {
      uri: 'present://runtime/registry',
      name: 'runtime.registry',
      mimeType: 'application/json',
      text: JSON.stringify(runtimeSurface.registry, null, 2),
    },
    {
      uri: 'present://runtime/interop',
      name: 'runtime.interop',
      mimeType: 'application/json',
      text: JSON.stringify(runtimeSurface.agentPack, null, 2),
    },
    {
      uri: 'present://workspaces/state',
      name: 'workspace.state',
      mimeType: 'application/json',
      text: JSON.stringify(workspaces, null, 2),
    },
    {
      uri: 'present://executors/state',
      name: 'executor.state',
      mimeType: 'application/json',
      text: JSON.stringify(executors, null, 2),
    },
    {
      uri: 'present://tasks/state',
      name: 'task.state',
      mimeType: 'application/json',
      text: JSON.stringify(tasks, null, 2),
    },
    {
      uri: 'present://artifacts/state',
      name: 'artifact.state',
      mimeType: 'application/json',
      text: JSON.stringify(artifacts, null, 2),
    },
    {
      uri: 'present://workspace/files',
      name: 'workspace.files',
      mimeType: 'application/json',
      text: JSON.stringify(
        workspaces.map((scopedWorkspace) => ({
          workspaceSessionId: scopedWorkspace.id,
          workspacePath: scopedWorkspace.workspacePath,
          files: listWorkspaceFiles({ workspaceSessionId: scopedWorkspace.id, limit: 120 }),
        })),
        null,
        2,
      ),
    },
    {
      uri: 'present://artifact/diff',
      name: 'artifact.diff',
      mimeType: latestPatchArtifact?.mimeType ?? 'text/plain',
      text: latestPatchArtifact?.content ?? '',
    },
    {
      uri: 'present://approvals/state',
      name: 'approval.state',
      mimeType: 'application/json',
      text: JSON.stringify(approvals, null, 2),
    },
    {
      uri: 'present://presence/state',
      name: 'presence.state',
      mimeType: 'application/json',
      text: JSON.stringify(presence, null, 2),
    },
    {
      uri: 'present://traces/state',
      name: 'trace.state',
      mimeType: 'application/json',
      text: JSON.stringify(traces, null, 2),
    },
    {
      uri: 'present://models/status',
      name: 'model.status',
      mimeType: 'application/json',
      text: JSON.stringify(modelProfiles, null, 2),
    },
  ];
}

export default {
  presentMcpTools,
  listPresentMcpResources,
};
