'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { systemRegistry } from '@/lib/system-registry';
import {
  buildCapabilitiesForProfile,
  resolveCapabilityProfile,
  type ComponentCapability,
  type ToolCapability,
} from '@/lib/agents/capabilities';

/**
 * AgentCapabilitiesBridge
 *
 * Listens for 'capability_query' on the LiveKit data channel and responds with
 * a 'capability_list' message containing tools, decision engine config, and components.
 */
export function AgentCapabilitiesBridge() {
  const room = useRoomContext();

  const bus = React.useMemo(() => (room ? createLiveKitBus(room) : null), [room]);

  React.useEffect(() => {
    if (!room || !bus) return;

    const off = bus.on('capability_query', async (request) => {
      try {
        const requestRecord = (request || {}) as Record<string, unknown>;
        const requestedProfile = resolveCapabilityProfile(
          typeof requestRecord.capabilityProfile === 'string'
            ? requestRecord.capabilityProfile
            : undefined,
        );

        // Build capabilities from the SystemRegistry
        const exported = systemRegistry.exportForAgent();
        const exportedTools = (exported.tools || []) as ToolCapability[];

        // Components list (fallback to local registry if needed)
        let components: ComponentCapability[];
        try {
          const mod = await import('@/lib/custom');
          const local = (mod as any).components || [];
          components = local.map((c: any) => ({
            name: c.name,
            description: c.description || `${c.name} component`,
            examples: c.examples || [],
            group: c.group,
            tier: c.tier,
            lifecycleOps: c.lifecycleOps,
            critical: c.critical,
          }));
        } catch {
          components = [];
        }

        const capabilities = buildCapabilitiesForProfile(requestedProfile, {
          tools: exportedTools,
          components,
        });

        const response = {
          type: 'capability_list',
          capabilityProfile: requestedProfile,
          capabilities,
          timestamp: Date.now(),
        };

        bus.send('capability_query', response);
      } catch (e) {
        console.warn('[AgentCapabilitiesBridge] Failed to send capability_list', e);
      }
    });

    return () => {
      off();
    };
  }, [room, bus]);

  return null;
}
