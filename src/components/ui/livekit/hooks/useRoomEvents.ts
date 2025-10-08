import { useEffect, useRef } from 'react';
import { ConnectionState, Room, RoomEvent, DisconnectReason, Participant } from 'livekit-client';

export interface RoomEventHandlers {
  onConnected?: (room: Room) => void;
  onDisconnected?: (room: Room, reason?: DisconnectReason) => void;
  onReconnecting?: (room: Room) => void;
  onReconnected?: (room: Room) => void;
  onParticipantConnected?: (room: Room, participant: Participant) => void;
  onParticipantDisconnected?: (room: Room, participant: Participant) => void;
}

export function useRoomEvents(
  room: Room | undefined,
  roomName: string,
  handlers: RoomEventHandlers,
) {
  const handlersRef = useRef<RoomEventHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!room) {
      console.error(`❌ [LiveKitConnector-${roomName}] No room instance available`);
      return;
    }

    const handleConnected = () => {
      handlersRef.current.onConnected?.(room);
    };

    const handleDisconnected = (reason?: DisconnectReason) => {
      handlersRef.current.onDisconnected?.(room, reason);
    };

    const handleReconnecting = () => {
      handlersRef.current.onReconnecting?.(room);
    };

    const handleReconnected = () => {
      handlersRef.current.onReconnected?.(room);
    };

    const handleParticipantConnected = (participant: Participant) => {
      handlersRef.current.onParticipantConnected?.(room, participant);
    };

    const handleParticipantDisconnected = (participant: Participant) => {
      handlersRef.current.onParticipantDisconnected?.(room, participant);
    };

    // Listen to room events
    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);

    // Emit initial state snapshot for existing connections
    switch (room.state) {
      case ConnectionState.Connected:
        handleConnected();
        break;
      case ConnectionState.Connecting:
      case ConnectionState.Reconnecting:
        handleReconnecting();
        break;
      default:
        handleDisconnected();
        break;
    }

    return () => {
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.Reconnecting, handleReconnecting);
      room.off(RoomEvent.Reconnected, handleReconnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected);
    };
  }, [room, roomName]);
}
