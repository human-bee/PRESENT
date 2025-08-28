'use client';

import { systemRegistry } from './system-registry';

type RegistryLike = Map<string, any> | Record<string, any> | undefined | null;

export function listWindowMcpTools(): string[] {
  if (typeof window === 'undefined') return [];
  const tools = (window as any).__tambo_mcp_tools || {};
  return Object.keys(tools);
}

export function listRegistryTools(registry: RegistryLike): string[] {
  if (!registry) return [];
  if (registry instanceof Map) return Array.from(registry.keys());
  if (typeof registry === 'object') return Object.keys(registry);
  return [];
}

export function getCapabilitySnapshot() {
  try {
    return systemRegistry.getSnapshot?.() ?? [];
  } catch {
    return [];
  }
}

export function computeMcpMappings(registry: RegistryLike) {
  const regNames = new Set(listRegistryTools(registry));
  const windowNames = new Set(listWindowMcpTools());
  const caps = getCapabilitySnapshot();

  return caps
    .filter((c: any) => c.type === 'mcp_tool' || c.mcpToolName)
    .map((c: any) => {
      const mcp = c.mcpToolName || c.name;
      return {
        agentTool: c.agentToolName || c.id || c.name,
        mcpTool: mcp,
        inRegistry: regNames.has(mcp) || regNames.has(`mcp_${mcp}`),
        inWindow: windowNames.has(`mcp_${mcp}`) || windowNames.has(mcp),
      };
    });
}
