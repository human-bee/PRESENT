import { z } from 'zod';
import {
  applyArtifactPatch,
  buildRuntimeManifest,
  createApprovalRequest,
  createArtifact,
  createWorkspacePatchArtifact,
  getArtifact,
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
      const artifact = getArtifact(input.artifactId);
      if (!artifact) {
        throw new Error('Artifact not found');
      }
      return { artifact };
    },
  },
  artifactApplyPatch: {
    name: 'artifact.applyPatch',
    description: 'Apply a reset file patch artifact into the workspace via git apply.',
    schema: {
      artifactId: z.string().min(1),
    },
    async run(input: { artifactId: string }) {
      return { artifact: applyArtifactPatch(input.artifactId) };
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
      return { events: searchTraceEvents(input.query ?? '') };
    },
  },
};

export async function listPresentMcpResources() {
  const modelProfiles = await resolveKernelModelProfiles();
  const artifacts = listArtifacts();
  const latestPatchArtifact = artifacts.find((artifact) => artifact.kind === 'file_patch') ?? null;

  return [
    {
      uri: 'present://runtime/manifest',
      name: 'runtime.manifest',
      mimeType: 'application/json',
      text: JSON.stringify(buildRuntimeManifest(), null, 2),
    },
    {
      uri: 'present://workspaces/state',
      name: 'workspace.state',
      mimeType: 'application/json',
      text: JSON.stringify(listWorkspaceSessions(), null, 2),
    },
    {
      uri: 'present://executors/state',
      name: 'executor.state',
      mimeType: 'application/json',
      text: JSON.stringify(listExecutorSessions(), null, 2),
    },
    {
      uri: 'present://tasks/state',
      name: 'task.state',
      mimeType: 'application/json',
      text: JSON.stringify(listTaskRuns(), null, 2),
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
        listWorkspaceSessions().map((workspace) => ({
          workspaceSessionId: workspace.id,
          workspacePath: workspace.workspacePath,
          files: listWorkspaceFiles({ workspaceSessionId: workspace.id, limit: 120 }),
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
      text: JSON.stringify(listApprovalRequests(), null, 2),
    },
    {
      uri: 'present://presence/state',
      name: 'presence.state',
      mimeType: 'application/json',
      text: JSON.stringify(listPresenceMembers(), null, 2),
    },
    {
      uri: 'present://traces/state',
      name: 'trace.state',
      mimeType: 'application/json',
      text: JSON.stringify(listTraceEvents(), null, 2),
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
