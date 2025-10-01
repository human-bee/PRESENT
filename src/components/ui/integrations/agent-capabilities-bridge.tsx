'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import { systemRegistry } from '@/lib/system-registry';

/**
 * AgentCapabilitiesBridge
 *
 * Listens for 'capability_query' on the LiveKit data channel and responds with
 * a 'capability_list' message containing tools, decision engine config, and components.
 */
export function AgentCapabilitiesBridge() {
  const room = useRoomContext();

  React.useEffect(() => {
    if (!room) return;
    const bus = createLiveKitBus(room);

    const off = bus.on('capability_query', async () => {
      try {
        // Build capabilities from the SystemRegistry
        const exported = systemRegistry.exportForAgent();

        // Components list (fallback to local registry if needed)
        let components: Array<{ name: string; description: string; examples?: string[] }>; 
        try {
          const mod = await import('@/lib/custom');
          const local = (mod as any).components || [];
          components = local.map((c: any) => ({
            name: c.name,
            description: c.description || `${c.name} component`,
            examples: c.examples || [],
          }));
        } catch {
          components = [];
        }

        const response = {
          type: 'capability_list',
          capabilities: {
            tools: exported.tools || [],
            decisionEngine: exported.decisionEngine || { intents: {}, keywords: {} },
            components,
          },
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
  }, [room]);

  return null;
}

