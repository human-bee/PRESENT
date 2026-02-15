'use client';

import * as React from 'react';
import { useRoomContext } from '@livekit/components-react';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

/**
 * LiveKitDebugConsole
 * Subscribes to common data-channel topics and logs clean, structured traces.
 * Dev-only helper; renders nothing.
 */
export function LiveKitDebugConsole({ enabled = true }: { enabled?: boolean }) {
  const room = useRoomContext();
  const bus = React.useMemo(() => createLiveKitBus(room), [room]);

  React.useEffect(() => {
    if (!enabled || !room) return;

    const log = (tag: string, payload: unknown) => {
      try {
        // Compact preview in console without flooding
        const preview = typeof payload === 'string' ? payload : JSON.stringify(payload);
        // eslint-disable-next-line no-console
        console.log(`[LK:${tag}]`, preview?.slice?.(0, 2000) ?? preview);
      } catch {
        // eslint-disable-next-line no-console
        console.log(`[LK:${tag}]`, payload);
      }
    };

    const offDecision = bus.on('decision', (m) => log('decision', m));
    const offToolCall = bus.on('tool_call', (m) => log('tool_call', m));
    const offToolRes = bus.on('tool_result', (m) => log('tool_result', m));
    const offToolErr = bus.on('tool_error', (m) => log('tool_error', m));
    const offEditor = bus.on('editor_action', (m) => log('editor_action', m));
    const offCapability = bus.on('capability_query', (m) => log('capability', m));
    const offUpdateComponent = bus.on('update_component', (m) => log('update_component', m));
    const offTrace = bus.on('agent:trace', (m) => log('agent_trace', m));

    return () => {
      offDecision?.();
      offToolCall?.();
      offToolRes?.();
      offToolErr?.();
      offEditor?.();
      offCapability?.();
      offUpdateComponent?.();
      offTrace?.();
    };
  }, [enabled, room, bus]);

  return null;
}

export default LiveKitDebugConsole;
