import { useCallback, useEffect, useRef } from 'react';
import type { Room } from 'livekit-client';
import { AGENT_AUTO_TRIGGER_DELAY_MS } from '../utils';
import { useAgentDispatch, isAgentParticipant } from './useAgentDispatch';
import type { LivekitRoomConnectorState } from './utils/lk-types';

interface UseLkAgentRequestParams {
  roomName: string;
  connectionState: LivekitRoomConnectorState['connectionState'];
  mergeState: (patch: Partial<LivekitRoomConnectorState>) => void;
  getState: () => LivekitRoomConnectorState;
  autoRequestEnabled?: boolean;
}

interface LkAgentRequestApi {
  requestAgent: () => Promise<void>;
  scheduleAgentJoin: (room: Room) => void;
  clearAgentAutoTrigger: () => void;
}

export function useLkAgentRequest({
  roomName,
  connectionState,
  mergeState,
  getState,
  autoRequestEnabled = true,
}: UseLkAgentRequestParams): LkAgentRequestApi {
  const agentAutoTriggerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { requestAgent: rawRequestAgent } = useAgentDispatch(
    roomName,
    connectionState,
    mergeState,
    getState,
  );

  const clearAgentAutoTrigger = useCallback(() => {
    if (agentAutoTriggerRef.current) {
      clearTimeout(agentAutoTriggerRef.current);
      agentAutoTriggerRef.current = null;
    }
  }, []);

  const requestAgent = useCallback(async () => {
    clearAgentAutoTrigger();
    await rawRequestAgent();
  }, [clearAgentAutoTrigger, rawRequestAgent]);

  const scheduleAgentJoin = useCallback(
    (eventRoom: Room) => {
      if (typeof window === 'undefined') {
        return;
      }
      if (!autoRequestEnabled) {
        clearAgentAutoTrigger();
        return;
      }

      const remoteParticipants = Array.from(eventRoom.remoteParticipants.values());
      const nonAgentParticipants = remoteParticipants.filter((participant) => !isAgentParticipant(participant));
      const agentParticipants = remoteParticipants.filter((participant) => isAgentParticipant(participant));

      if (nonAgentParticipants.length === 0 && agentParticipants.length === 0) {
        clearAgentAutoTrigger();
        agentAutoTriggerRef.current = setTimeout(() => {
          void requestAgent();
        }, AGENT_AUTO_TRIGGER_DELAY_MS);
      }
    },
    [autoRequestEnabled, clearAgentAutoTrigger, requestAgent],
  );

  useEffect(() => clearAgentAutoTrigger, [clearAgentAutoTrigger]);

  return { requestAgent, scheduleAgentJoin, clearAgentAutoTrigger };
}
