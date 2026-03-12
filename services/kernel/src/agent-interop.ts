import { agentInteropPackSchema, type AgentInteropPack, type WorkspaceSession } from '@present/contracts';
import { buildRuntimeManifest } from './runtime-manifest';

const createCommand = (command: string, args: string[], cwd: string) => ({
  command,
  args,
  cwd,
});

export function buildAgentInteropPack(workspace: WorkspaceSession | null): AgentInteropPack {
  const runtimeManifest = buildRuntimeManifest();
  const [mcpCommand = 'npm', ...mcpArgs] = runtimeManifest.mcp.command;
  const cwd = process.cwd();
  const workspaceScopeArgs = workspace ? ['--workspaceSessionId', workspace.id] : [];
  const workspacePathArgs = workspace ? ['--workspacePath', workspace.workspacePath] : ['--workspacePath', cwd];

  return agentInteropPackSchema.parse({
    generatedAt: new Date().toISOString(),
    workspaceSessionId: workspace?.id ?? null,
    workspacePath: workspace?.workspacePath ?? null,
    mcpServer: {
      name: runtimeManifest.mcp.serverName,
      transport: runtimeManifest.mcp.transport,
      command: mcpCommand,
      args: mcpArgs,
      cwd,
      env: workspace
        ? {
            PRESENT_RESET_WORKSPACE_SESSION_ID: workspace.id,
            PRESENT_RESET_WORKSPACE_PATH: workspace.workspacePath,
          }
        : {},
    },
    commands: {
      openWorkspace: createCommand('npm', ['run', 'fairy:cli', '--', 'reset', 'open', ...workspacePathArgs], cwd),
      inspectWorkspace: createCommand('npm', ['run', 'fairy:cli', '--', 'reset', 'status', ...workspaceScopeArgs], cwd),
      startTurn: createCommand(
        'npm',
        [
          'run',
          'fairy:cli',
          '--',
          'reset',
          'turn',
          ...workspaceScopeArgs,
          '--summary',
          workspace ? `${workspace.title} turn` : 'Reset turn',
          '--prompt',
          '<prompt>',
        ],
        cwd,
      ),
      printManifest: createCommand('npm', ['run', 'fairy:cli', '--', 'reset', 'manifest', ...workspaceScopeArgs], cwd),
    },
    recommendedClients: ['OpenClaw', 'Codex desktop', 'generic MCP clients'],
    notes: [
      'ChatGPT subscription auth stays on the local or desktop companion boundary.',
      'Hosted executors should use api_key, shared_key, or byok modes.',
      'Apply code changes through patch artifacts or approved workspace flows instead of browser-owned mutations.',
    ],
  });
}
