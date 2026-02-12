'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { systemRegistry } from '@/lib/system-registry';
import {
  buildCapabilitiesForProfile,
  normalizeCapabilityProfile,
  type CapabilityComponent,
  type CapabilityProfile,
} from '@/lib/agents/capabilities';

type LocalComponentDefinition = {
  name: string;
  description?: string;
  examples?: string[];
  tier?: string;
  group?: string;
  lifecycleOps?: string[];
  critical?: boolean;
};

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

    const off = bus.on('capability_query', async (payload: unknown) => {
      try {
        const requestedCapabilityProfile = normalizeCapabilityProfile(
          (payload as { capabilityProfile?: string })?.capabilityProfile ?? 'full',
        );

        // Build capabilities from the SystemRegistry
        const exported = systemRegistry.exportForAgent();

        // Components list (fallback to local registry if needed)
        let components: CapabilityComponent[];
        try {
          const mod = await import('@/lib/custom');
          const localUnknown = (mod as { components?: unknown }).components;
          const local = Array.isArray(localUnknown)
            ? (localUnknown as LocalComponentDefinition[])
            : [];
          components = local
            .filter((component) => typeof component?.name === 'string' && component.name.trim().length > 0)
            .map((component) => ({
              name: component.name,
              description: component.description || `${component.name} component`,
              examples: Array.isArray(component.examples) ? component.examples : [],
              tier: component.tier,
              group: component.group,
              lifecycleOps: component.lifecycleOps,
              critical: component.critical,
          }));
        } catch {
          components = [];
        }

        const capabilities = buildCapabilitiesForProfile(
          {
            tools: exported.tools || [],
            components,
          },
          requestedCapabilityProfile,
        );
        const resolvedProfile: CapabilityProfile =
          capabilities.capabilityProfile === 'lean_adaptive' ? 'lean_adaptive' : 'full';

        const response = {
          type: 'capability_list',
          capabilityProfile: resolvedProfile,
          requestedCapabilityProfile,
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
