/**
 * useValidatedcustom
 *
 * Returns a minimal "tool registry" derived from the System Registry so
 * MCP config UI can introspect names. Not tied to any SDK.
 */

'use client';

import { useMemo } from 'react';
import { systemRegistry } from '@/lib/system-registry';

export function useValidatedcustom() {
  const toolRegistry = useMemo(() => {
    const reg = new Map<string, any>();
    try {
      const caps = systemRegistry.getAllCapabilities();
      for (const cap of caps) {
        if (cap.agentToolName) {
          reg.set(cap.agentToolName, {});
        }
        if (cap.mcpToolName) {
          // support both plain and prefixed names for introspection
          reg.set(cap.mcpToolName, {});
          reg.set(`mcp_${cap.mcpToolName}`, {});
        }
      }
    } catch {
      // ignore
    }
    return reg;
  }, []);

  return { toolRegistry } as const;
}

