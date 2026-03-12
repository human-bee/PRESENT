import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  openWorkspaceSession,
  resetCollaborationDocumentsForTests,
  resetKernelStateForTests,
} from '@present/kernel';

jest.setTimeout(30_000);

const readToolJson = (result: { content?: Array<{ type?: string; text?: string }> }) => {
  const text = result.content?.find((item) => item.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
};

describe('present MCP stdio interop smoke', () => {
  let workspacePath = '';
  let statePath = '';
  let collaborationPath = '';
  let transport: StdioClientTransport | null = null;

  beforeEach(() => {
    statePath = path.join(os.tmpdir(), `present-reset-state-${Date.now()}-${Math.random()}.json`);
    collaborationPath = path.join(
      os.tmpdir(),
      `present-reset-collaboration-${Date.now()}-${Math.random()}.json`,
    );
    process.env.PRESENT_RESET_STATE_PATH = statePath;
    process.env.PRESENT_RESET_COLLABORATION_PATH = collaborationPath;
    resetKernelStateForTests();
    resetCollaborationDocumentsForTests();
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'present-reset-interop-'));
    fs.writeFileSync(path.join(workspacePath, 'README.md'), '# PRESENT\n', 'utf8');
  });

  afterEach(async () => {
    if (transport) {
      await transport.close().catch(() => {});
      transport = null;
    }
    resetKernelStateForTests();
    resetCollaborationDocumentsForTests();
    delete process.env.PRESENT_RESET_STATE_PATH;
    delete process.env.PRESENT_RESET_COLLABORATION_PATH;
    fs.rmSync(workspacePath, { recursive: true, force: true });
  });

  it('supports external-agent discovery and patch application over stdio', async () => {
    const workspace = openWorkspaceSession({
      workspacePath,
      title: 'Interop Smoke',
      branch: 'codex/reset-final-deliverables',
    });

    const client = new Client({
      name: 'present-reset-interop-smoke',
      version: '1.0.0',
    });

    transport = new StdioClientTransport({
      command: path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx'),
      args: ['services/present-mcp/src/server.ts'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        PRESENT_RESET_STATE_PATH: statePath,
        PRESENT_RESET_COLLABORATION_PATH: collaborationPath,
        PRESENT_RESET_WORKSPACE_SESSION_ID: workspace.id,
        PRESENT_RESET_WORKSPACE_PATH: workspace.workspacePath,
      } as Record<string, string>,
      stderr: 'pipe',
    });

    await client.connect(transport);

    const tools = await client.listTools();
    const interop = await client.readResource({ uri: 'present://runtime/interop' });
    const files = await client.callTool({
      name: 'workspace.files',
      arguments: { workspaceSessionId: workspace.id },
    });
    const patch = await client.callTool({
      name: 'workspace.createPatch',
      arguments: {
        workspaceSessionId: workspace.id,
        filePath: 'README.md',
        nextContent: '# PRESENT RESET\n',
        title: 'README patch',
      },
    });

    const patchPayload = readToolJson(patch);

    await client.callTool({
      name: 'artifact.applyPatch',
      arguments: {
        artifactId: patchPayload.artifact.id,
      },
    });

    const interopText = interop.contents?.map((item) => item.text ?? '').join('\n') ?? '';
    const filesPayload = readToolJson(files);

    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['workspace.files', 'workspace.createPatch', 'artifact.applyPatch']),
    );
    expect(interopText).toContain('OpenClaw');
    expect(filesPayload.files.map((entry: { name: string }) => entry.name)).toContain('README.md');
    expect(fs.readFileSync(path.join(workspacePath, 'README.md'), 'utf8')).toContain('# PRESENT RESET');
  });
});
