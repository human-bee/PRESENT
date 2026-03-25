'use client';

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { useCallback, useEffect } from 'react';
import { RoomConnectorUI } from '@/components/ui/livekit/components';
import { useLivekitConnection, useRoomEvents } from '@/components/ui/livekit/hooks';

type ResetRoomTelemetry = {
  roomName: string;
  connectionState: string;
  participantCount: number;
  agentStatus: string;
  media: {
    audio: boolean;
    video: boolean;
    screen: boolean;
  };
};

type ResetRoomPanelProps = {
  workspaceSessionId: string;
  roomId: string;
  operatorLabel: string;
  onTelemetryChange?: (telemetry: ResetRoomTelemetry) => void;
};

function ResetRoomPanelInner({
  workspaceSessionId,
  roomName,
  operatorLabel,
  onTelemetryChange,
}: {
  workspaceSessionId: string;
  roomName: string;
  operatorLabel: string;
  onTelemetryChange?: (telemetry: ResetRoomTelemetry) => void;
}) {
  const {
    state,
    connect,
    disconnect,
    requestAgent,
    toggleMinimized,
    roomEventHandlers,
    room,
  } = useLivekitConnection({
    roomName,
    userName: operatorLabel,
    autoConnect: false,
    audioOnly: false,
  });

  useRoomEvents(room, roomName, roomEventHandlers);

  useEffect(() => {
    const localParticipant = room?.localParticipant as
      | {
          isMicrophoneEnabled?: boolean;
          isCameraEnabled?: boolean;
          isScreenShareEnabled?: boolean;
        }
      | undefined;

    onTelemetryChange?.({
      roomName,
      connectionState: state.connectionState,
      participantCount: state.participantCount,
      agentStatus: state.agentStatus,
      media: {
        audio: Boolean(localParticipant?.isMicrophoneEnabled),
        video: Boolean(localParticipant?.isCameraEnabled),
        screen: Boolean(localParticipant?.isScreenShareEnabled),
      },
    });
  }, [onTelemetryChange, room, roomName, state.agentStatus, state.connectionState, state.participantCount]);

  const handleConnectToggle = useCallback(() => {
    if (state.connectionState === 'connected') {
      void disconnect();
      return;
    }
    if (state.connectionState === 'disconnected' || state.connectionState === 'error') {
      void connect();
    }
  }, [connect, disconnect, state.connectionState]);

  const handleRequestAgent = useCallback(() => {
    if (state.connectionState === 'connected') {
      void requestAgent();
    }
  }, [requestAgent, state.connectionState]);

  const copyResetInviteLink = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const link = `${window.location.origin}/?workspace=${encodeURIComponent(workspaceSessionId)}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch (error) {
      console.error(`[present-reset] Failed to copy room link for ${roomName}:`, error);
    }
  }, [roomName, workspaceSessionId]);

  return (
    <div className="reset-room-panel">
      <RoomConnectorUI
        state={state}
        roomName={roomName}
        onMinimize={toggleMinimized}
        onConnect={handleConnectToggle}
        onDisconnect={handleConnectToggle}
        onCopyLink={copyResetInviteLink}
        onRequestAgent={handleRequestAgent}
      />
      <RoomAudioRenderer />
    </div>
  );
}

export function ResetRoomPanel({ workspaceSessionId, roomId, operatorLabel, onTelemetryChange }: ResetRoomPanelProps) {
  const serverUrl =
    process.env.NEXT_PUBLIC_LIVEKIT_URL ??
    process.env.NEXT_PUBLIC_LK_SERVER_URL ??
    '';
  const roomName = roomId;

  if (!serverUrl) {
    return (
      <div className="reset-empty">
        LiveKit room controls are available when `NEXT_PUBLIC_LK_SERVER_URL` is configured.
      </div>
    );
  }

  return (
    <LiveKitRoom
      connect={false}
      audio={false}
      video={false}
      token={undefined}
      serverUrl={serverUrl}
    >
      <ResetRoomPanelInner
        workspaceSessionId={workspaceSessionId}
        roomName={roomName}
        operatorLabel={operatorLabel}
        onTelemetryChange={onTelemetryChange}
      />
    </LiveKitRoom>
  );
}
