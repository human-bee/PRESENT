import { runtimeManifestSchema, type ConnectorRegistrySnapshot, type WorkspaceSession } from '@present/contracts';
import { buildConnectorRegistrySnapshot, createCanvasRoomId } from './connector-registry';

export function buildRuntimeManifest(
  workspace: WorkspaceSession | null = null,
  options: { generatedAt?: string; registry?: ConnectorRegistrySnapshot } = {},
) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const registry = options.registry ?? buildConnectorRegistrySnapshot(workspace, { generatedAt });
  return runtimeManifestSchema.parse({
    generatedAt,
    schemaVersion: 'canvas-os/v1',
    runtimeCenter: 'responses',
    primarySurface: 'canvas',
    codex: {
      appServerBaseUrl: process.env.CODEX_APP_SERVER_URL ?? 'http://127.0.0.1:4096',
      authModes: ['chatgpt', 'api_key', 'shared_key', 'byok'],
      recommendedModels: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'],
    },
    mcp: {
      serverName: 'present-mcp',
      transport: 'stdio',
      command: ['npm', 'run', 'present:mcp'],
    },
    connectors: registry.connectors,
    resources: registry.resources,
    events: registry.events,
    approvalPolicies: registry.approvalPolicies,
    traceSchemaUri: 'present://schemas/trace-linkage',
    registry: {
      uri: 'present://runtime/registry',
      updatedAt: registry.generatedAt,
      connectorCount: registry.connectors.length,
    },
    media: {
      provider: 'livekit',
      transport: 'webrtc',
      supports: ['audio', 'video', 'screen', 'data_channel'],
      roomIdTemplate: 'reset-{workspaceSessionId}',
    },
    collaboration: {
      livekitEnabled: true,
      canvasEnabled: true,
      widgetsEnabled: true,
      dualClient: true,
      canvasTransport: 'tldraw_sync',
      sharedDocTransport: 'yjs_ws',
      presenceTransport: 'webrtc',
      operatorSurfaces: ['canvas', 'shell', 'archive'],
      defaultRoomId: workspace ? createCanvasRoomId(workspace.id) : null,
    },
  });
}
