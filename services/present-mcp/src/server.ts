import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listPresentMcpResources, presentMcpTools } from './toolkit';

const server = new McpServer({
  name: 'present-mcp',
  version: '0.2.0-reset',
});

const registerResource = (name: string, uri: string) => {
  server.resource(name, uri, async () => {
    const resources = await listPresentMcpResources();
    return {
      contents: resources
        .filter((resource) => resource.uri === uri)
        .map((resource) => ({
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.text,
        })),
    };
  });
};

registerResource('runtime.manifest', 'present://runtime/manifest');
registerResource('workspace.state', 'present://workspaces/state');
registerResource('executor.state', 'present://executors/state');
registerResource('task.state', 'present://tasks/state');
registerResource('artifact.state', 'present://artifacts/state');
registerResource('workspace.files', 'present://workspace/files');
registerResource('artifact.diff', 'present://artifact/diff');
registerResource('approval.state', 'present://approvals/state');
registerResource('presence.state', 'present://presence/state');
registerResource('trace.state', 'present://traces/state');
registerResource('model.status', 'present://models/status');

server.tool(
  presentMcpTools.workspaceOpen.name,
  presentMcpTools.workspaceOpen.description,
  {
    workspacePath: z.string(),
    branch: z.string().optional(),
    title: z.string().optional(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.workspaceOpen.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.taskEnqueue.name,
  presentMcpTools.taskEnqueue.description,
  {
    workspaceSessionId: z.string(),
    summary: z.string(),
    taskType: z.string(),
    prompt: z.string().optional(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.taskEnqueue.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.workspaceFiles.name,
  presentMcpTools.workspaceFiles.description,
  {
    workspaceSessionId: z.string(),
    directoryPath: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.workspaceFiles.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.workspaceReadFile.name,
  presentMcpTools.workspaceReadFile.description,
  {
    workspaceSessionId: z.string(),
    filePath: z.string(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.workspaceReadFile.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.workspaceCreatePatch.name,
  presentMcpTools.workspaceCreatePatch.description,
  {
    workspaceSessionId: z.string(),
    filePath: z.string(),
    nextContent: z.string(),
    traceId: z.string().optional(),
    title: z.string().optional(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.workspaceCreatePatch.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.turnStart.name,
  presentMcpTools.turnStart.description,
  {
    workspaceSessionId: z.string(),
    prompt: z.string(),
    summary: z.string(),
    executorSessionId: z.string().optional(),
    model: z.string().optional(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.turnStart.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.canvasRun.name,
  presentMcpTools.canvasRun.description,
  {
    workspaceSessionId: z.string(),
    prompt: z.string(),
    summary: z.string().optional(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.canvasRun.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.widgetCreate.name,
  presentMcpTools.widgetCreate.description,
  {
    workspaceSessionId: z.string(),
    title: z.string(),
    html: z.string(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.widgetCreate.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.artifactGet.name,
  presentMcpTools.artifactGet.description,
  {
    artifactId: z.string(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.artifactGet.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.artifactApplyPatch.name,
  presentMcpTools.artifactApplyPatch.description,
  {
    artifactId: z.string(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.artifactApplyPatch.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.approvalRequest.name,
  presentMcpTools.approvalRequest.description,
  {
    workspaceSessionId: z.string(),
    traceId: z.string(),
    kind: z.enum(['file_write', 'shell_exec', 'network_access', 'git_action', 'tool_escalation']),
    title: z.string(),
    detail: z.string(),
    requestedBy: z.string(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.approvalRequest.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.approvalResolve.name,
  presentMcpTools.approvalResolve.description,
  {
    approvalRequestId: z.string(),
    state: z.enum(['approved', 'rejected', 'expired']),
    resolvedBy: z.string(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.approvalResolve.run(input), null, 2) }],
  }),
);

server.tool(
  presentMcpTools.traceSearch.name,
  presentMcpTools.traceSearch.description,
  {
    query: z.string().optional(),
  },
  async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(await presentMcpTools.traceSearch.run(input), null, 2) }],
  }),
);

const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  process.stderr.write(`present-mcp failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
