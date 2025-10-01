import { useEffect } from 'react';
import { Room, RoomEvent, DisconnectReason, ConnectionState, Participant } from 'livekit-client';
import { isAgentParticipant } from './useAgentDispatch';

/**
 * Sets up event listeners for LiveKit room events
 * Handles connection state changes and participant join/leave
 */
export function useRoomEvents(
  room: Room | undefined,
  roomName: string,
  setState: (updater: (prev: any) => any) => void,
  stateRef: React.RefObject<any>,
  triggerAgentJoin?: () => void,
) {
  useEffect(() => {
    if (!room) {
      console.error(`❌ [LiveKitConnector-${roomName}] No room instance available`);
      return;
    }

    const handleConnected = () => {
      if (stateRef.current?.connectionState !== 'connected') {
        console.log(`✅ [LiveKitConnector-${roomName}] User connected to room`);
        setState((prev: any) => ({
          ...prev,
          connectionState: 'connected',
          participantCount: room.numParticipants,
          errorMessage: null,
        }));

        // Auto-trigger agent join for first human participant
        if (triggerAgentJoin) {
          const nonAgentParticipants = Array.from(room.remoteParticipants.values()).filter(
            (p) => !isAgentParticipant(p),
          );
          const agentParticipants = Array.from(room.remoteParticipants.values()).filter((p) =>
            isAgentParticipant(p),
          );

          if (nonAgentParticipants.length === 0 && agentParticipants.length === 0) {
            console.log(
              `🤖 [LiveKitConnector-${roomName}] First participant connected, triggering agent...`,
            );
            setTimeout(() => {
              triggerAgentJoin();
            }, 2000);
          }
        }
      }
    };

    const handleDisconnected = (reason?: DisconnectReason) => {
      if (stateRef.current?.connectionState !== 'disconnected') {
        setState((prev: any) => ({
          ...prev,
          connectionState: 'disconnected',
          participantCount: 0,
          errorMessage: reason ? `Disconnected: ${reason}` : null,
        }));
      }
    };

    const handleReconnecting = () => {
      if (stateRef.current?.connectionState !== 'connecting') {
        setState((prev: any) => ({
          ...prev,
          connectionState: 'connecting',
          errorMessage: 'Reconnecting...',
        }));
      }
    };

    const handleReconnected = () => {
      if (stateRef.current?.connectionState !== 'connected') {
        setState((prev: any) => ({
          ...prev,
          connectionState: 'connected',
          participantCount: room.numParticipants,
          errorMessage: null,
        }));
      }
    };

    const handleParticipantConnected = (participant: Participant) => {
      console.log(`👥 [LiveKitConnector-${roomName}] Participant connected:`, {
        identity: participant.identity,
        name: participant.name,
        metadata: participant.metadata,
      });

      if (isAgentParticipant(participant)) {
        console.log(
          `🎉 [LiveKitConnector-${roomName}] 🤖 AI AGENT SUCCESSFULLY JOINED THE ROOM! 🎉`,
          {
            identity: participant.identity,
            name: participant.name,
            totalParticipants: room.numParticipants,
          },
        );
        setState((prev: any) => ({
          ...prev,
          participantCount: room.numParticipants,
          agentStatus: 'joined',
          agentIdentity: participant.identity,
        }));
      } else {
        console.log(
          `👤 [LiveKitConnector-${roomName}] Human participant connected: ${participant.identity}`,
        );
        setState((prev: any) => ({
          ...prev,
          participantCount: room.numParticipants,
        }));
      }
    };

    const handleParticipantDisconnected = (participant: Participant) => {
      console.log(`👥 [LiveKitConnector-${roomName}] Participant disconnected:`, {
        identity: participant.identity,
        remainingParticipants: room.numParticipants - 1,
      });

      if (isAgentParticipant(participant) && stateRef.current?.agentIdentity === participant.identity) {
        console.log(
          `😔 [LiveKitConnector-${roomName}] AI Agent left the room: ${participant.identity}`,
        );
        setState((prev: any) => ({
          ...prev,
          participantCount: room.numParticipants,
          agentStatus: 'not-requested',
          agentIdentity: null,
        }));
      } else {
        setState((prev: any) => ({
          ...prev,
          participantCount: room.numParticipants,
        }));
      }
    };

    // Check initial state
    const newConnState =
      room.state === ConnectionState.Connected
        ? 'connected'
        : room.state === ConnectionState.Connecting || room.state === ConnectionState.Reconnecting
          ? 'connecting'
          : 'disconnected';
    const newParticipantCount = room.numParticipants;

    if (
      stateRef.current &&
      (stateRef.current.connectionState !== newConnState ||
        stateRef.current.participantCount !== newParticipantCount)
    ) {
      setState((prev: any) => ({
        ...prev,
        connectionState: newConnState,
        participantCount: newParticipantCount,
      }));
    }

    // Listen to room events
    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

    return () => {
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.Reconnecting, handleReconnecting);
      room.off(RoomEvent.Reconnected, handleReconnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [room, roomName, setState, stateRef, triggerAgentJoin]);
}
