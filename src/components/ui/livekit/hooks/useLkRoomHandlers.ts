import { useCallback, useMemo } from 'react';
import { DisconnectReason, Participant, Room } from 'livekit-client';
import type { RoomEventHandlers } from './useRoomEvents';
import type { LivekitRoomConnectorState } from './utils/lk-types';
import { isAgentParticipant } from './useAgentDispatch';

interface UseLkRoomHandlersParams {
  mergeState: (patch: Partial<LivekitRoomConnectorState>) => void;
  scheduleAgentJoin: (room: Room) => void;
  clearAgentAutoTrigger: () => void;
  getState: () => LivekitRoomConnectorState;
}

export function useLkRoomHandlers({
  mergeState,
  scheduleAgentJoin,
  clearAgentAutoTrigger,
  getState,
}: UseLkRoomHandlersParams): RoomEventHandlers {
  const handleRoomConnected = useCallback(
    (eventRoom: Room) => {
      mergeState({
        connectionState: 'connected',
        participantCount: eventRoom.numParticipants,
        errorMessage: null,
      });
      scheduleAgentJoin(eventRoom);
    },
    [mergeState, scheduleAgentJoin],
  );

  const handleRoomDisconnected = useCallback(
    (_eventRoom: Room, reason?: DisconnectReason) => {
      clearAgentAutoTrigger();
      mergeState({
        connectionState: 'disconnected',
        participantCount: 0,
        errorMessage: reason ? `Disconnected: ${reason}` : null,
        agentStatus: 'not-requested',
        agentIdentity: null,
        token: null,
      });
    },
    [clearAgentAutoTrigger, mergeState],
  );

  const handleRoomReconnecting = useCallback(() => {
    clearAgentAutoTrigger();
    mergeState({
      connectionState: 'reconnecting',
      errorMessage: 'Reconnecting...',
    });
  }, [clearAgentAutoTrigger, mergeState]);

  const handleRoomReconnected = useCallback(
    (eventRoom: Room) => {
      mergeState({
        connectionState: 'connected',
        participantCount: eventRoom.numParticipants,
        errorMessage: null,
      });
      scheduleAgentJoin(eventRoom);
    },
    [mergeState, scheduleAgentJoin],
  );

  const handleParticipantConnected = useCallback(
    (eventRoom: Room, participant: Participant) => {
      clearAgentAutoTrigger();
      if (isAgentParticipant(participant)) {
        mergeState({
          participantCount: eventRoom.numParticipants,
          agentStatus: 'joined',
          agentIdentity: participant.identity,
          errorMessage: null,
        });
      } else {
        mergeState({
          participantCount: eventRoom.numParticipants,
        });
      }
    },
    [clearAgentAutoTrigger, mergeState],
  );

  const handleParticipantDisconnected = useCallback(
    (eventRoom: Room, participant: Participant) => {
      if (isAgentParticipant(participant) && getState().agentIdentity === participant.identity) {
        mergeState({
          participantCount: eventRoom.numParticipants,
          agentStatus: 'not-requested',
          agentIdentity: null,
        });
        scheduleAgentJoin(eventRoom);
      } else {
        mergeState({
          participantCount: eventRoom.numParticipants,
        });
      }
    },
    [getState, mergeState, scheduleAgentJoin],
  );

  return useMemo(
    () => ({
      onConnected: handleRoomConnected,
      onDisconnected: handleRoomDisconnected,
      onReconnecting: handleRoomReconnecting,
      onReconnected: handleRoomReconnected,
      onParticipantConnected: handleParticipantConnected,
      onParticipantDisconnected: handleParticipantDisconnected,
    }),
    [
      handleRoomConnected,
      handleRoomDisconnected,
      handleRoomReconnecting,
      handleRoomReconnected,
      handleParticipantConnected,
      handleParticipantDisconnected,
    ],
  );
}
