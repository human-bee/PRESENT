import {
  agentInteropPackSchema,
  type AgentInteropPack,
  type CanvasEventDescriptor,
  type CanvasResourceDescriptor,
  type ConnectorRegistrySnapshot,
  type RuntimeManifest,
  type WorkspaceSession,
} from '@present/contracts';
import { buildConnectorRegistrySnapshot, createCanvasRoomId } from './connector-registry';
import { buildRuntimeManifest } from './runtime-manifest';

const createCommand = (command: string, args: string[], cwd: string) => ({
  command,
  args,
  cwd,
});

const getResourceUri = (
  resources: CanvasResourceDescriptor[],
  resourceId: string,
  fallback: string,
) => resources.find((resource) => resource.id === resourceId)?.uri ?? fallback;

const getEventChannel = (
  events: CanvasEventDescriptor[],
  eventId: string,
  fallback: string,
) => events.find((event) => event.id === eventId)?.channel ?? fallback;

export function buildAgentInteropPack(
  workspace: WorkspaceSession | null,
  options: { generatedAt?: string; registry?: ConnectorRegistrySnapshot; runtimeManifest?: RuntimeManifest } = {},
): AgentInteropPack {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const registry = options.registry ?? buildConnectorRegistrySnapshot(workspace, { generatedAt });
  const runtimeManifest = options.runtimeManifest ?? buildRuntimeManifest(workspace, { generatedAt, registry });
  const [mcpCommand = 'npm', ...mcpArgs] = runtimeManifest.mcp.command;
  const cwd = process.cwd();
  const workspaceScopeArgs = workspace ? ['--workspaceSessionId', workspace.id] : [];
  const workspacePathArgs = workspace ? ['--workspacePath', workspace.workspacePath] : ['--workspacePath', cwd];
  const roomId = registry.roomId ?? (workspace ? createCanvasRoomId(workspace.id) : null);

  return agentInteropPackSchema.parse({
    generatedAt,
    surface: 'canvas',
    workspaceSessionId: workspace?.id ?? null,
    workspacePath: workspace?.workspacePath ?? null,
    manifestUri: getResourceUri(registry.resources, 'runtime.manifest', 'present://runtime/manifest'),
    registryUri: getResourceUri(registry.resources, 'runtime.registry', 'present://runtime/registry'),
    resourceUris: {
      manifest: getResourceUri(registry.resources, 'runtime.manifest', 'present://runtime/manifest'),
      registry: getResourceUri(registry.resources, 'runtime.registry', 'present://runtime/registry'),
      workspace: getResourceUri(registry.resources, 'workspace.state', 'present://workspaces/state'),
      artifacts: getResourceUri(registry.resources, 'artifact.state', 'present://artifacts/state'),
      approvals: getResourceUri(registry.resources, 'approval.state', 'present://approvals/state'),
      presence: getResourceUri(registry.resources, 'presence.state', 'present://presence/state'),
      traces: getResourceUri(registry.resources, 'trace.state', 'present://traces/state'),
      models: getResourceUri(registry.resources, 'model.status', 'present://models/status'),
    },
    eventUris: {
      taskStreamTemplate: getEventChannel(registry.events, 'task.stream', '/api/reset/tasks/{taskId}/events'),
      traces: getEventChannel(registry.events, 'trace.search', '/api/reset/traces'),
      presence: getEventChannel(registry.events, 'presence.upsert', '/api/reset/presence'),
      livekitCommentary: getEventChannel(
        registry.events,
        'livekit.commentary',
        roomId ? `livekit:data-channel:${roomId}` : 'livekit:data-channel:{roomId}',
      ),
    },
    approvalUris: {
      state: getResourceUri(registry.resources, 'approval.state', 'present://approvals/state'),
      resolve: '/api/reset/approvals',
    },
    roomId,
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
    connectorHints: registry.connectors.map((connector) => ({
      connectorId: connector.id,
      purpose:
        connector.id === 'codex-app-server'
          ? 'Primary coding and artifact generation lane.'
          : connector.id === 'openclaw-acp'
            ? 'Secondary BYO-agent adapter lane.'
            : connector.id === 'livekit-room'
              ? 'Realtime room presence, voice, video, and commentary.'
              : `${connector.label} runtime surface.`,
      preferWhen:
        connector.id === 'codex-app-server'
          ? 'You need a rich coding turn, approval-aware patch flow, or app-server auth.'
          : connector.id === 'openclaw-acp'
            ? 'You need an external ACP-compatible runtime or plugin bridge.'
            : connector.id === 'present-mcp'
              ? 'You need canonical workspace, artifact, approval, or trace state.'
              : connector.id === 'livekit-room'
                ? 'You need live voice, video, screen share, or ephemeral room sync.'
                : 'You need the canvas surface to stay in sync.',
    })),
    recommendedClients: ['OpenClaw', 'Codex desktop', 'generic MCP clients'],
    notes: [
      'Canvas is the primary surface; treat the shell as an operator rail over the same kernel state.',
      'ChatGPT subscription auth stays on the local or desktop companion boundary.',
      'Hosted executors should use api_key, shared_key, or byok modes.',
      'Apply code changes through patch artifacts or approved workspace flows instead of browser-owned mutations.',
    ],
  });
}
