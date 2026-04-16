import type { AgentInteropPack, ConnectorRegistrySnapshot, RuntimeManifest, WorkspaceSession } from '@present/contracts';
import { buildAgentInteropPack } from './agent-interop';
import { buildConnectorRegistrySnapshot } from './connector-registry';
import { buildRuntimeManifest } from './runtime-manifest';

export type CanvasRuntimeSurface = {
  generatedAt: string;
  registry: ConnectorRegistrySnapshot;
  manifest: RuntimeManifest;
  agentPack: AgentInteropPack;
};

export function buildCanvasRuntimeSurface(workspace: WorkspaceSession | null = null): CanvasRuntimeSurface {
  const generatedAt = new Date().toISOString();
  const registry = buildConnectorRegistrySnapshot(workspace, { generatedAt });
  const manifest = buildRuntimeManifest(workspace, { generatedAt, registry });
  const agentPack = buildAgentInteropPack(workspace, {
    generatedAt,
    registry,
    runtimeManifest: manifest,
  });

  return {
    generatedAt,
    registry,
    manifest,
    agentPack,
  };
}
