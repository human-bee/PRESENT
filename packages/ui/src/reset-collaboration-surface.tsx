'use client';

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RoomScopedProviders } from '@/components/RoomScopedProviders';
import { ToolDispatcher } from '@/components/tool-dispatcher';
import { RoomConnectorUI } from '@/components/ui/livekit/components';
import { CanvasLiveKitContext } from '@/components/ui/livekit/livekit-room-connector';
import { useLivekitConnection, useRoomEvents } from '@/components/ui/livekit/hooks';
import { TldrawWithCollaboration } from '@/components/ui/tldraw/tldraw-with-collaboration';

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

type ResetCollaborationSurfaceProps = {
  workspaceSessionId: string;
  operatorLabel: string;
  onTelemetryChange?: (telemetry: ResetRoomTelemetry) => void;
};

function ResetCollaborationSurfaceInner({
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
    const link = `${window.location.origin}/?room=${encodeURIComponent(roomName)}`;
    try {
      await navigator.clipboard.writeText(link);
    } catch (error) {
      console.error(`[present-reset] Failed to copy room link for ${roomName}:`, error);
    }
  }, [roomName]);

  const roomContext = useMemo(
    () => ({
      isConnected: state.connectionState === 'connected',
      roomName,
      participantCount: state.participantCount,
    }),
    [roomName, state.connectionState, state.participantCount],
  );

  return (
    <RoomScopedProviders>
      <ToolDispatcher contextKey={`reset:${workspaceSessionId}:${roomName}`}>
        <CanvasLiveKitContext.Provider value={roomContext}>
          <div className="reset-collaboration-surface">
            <div className="reset-collaboration-surface__controls">
              <div className="reset-frame-title">Room Controls</div>
              <RoomConnectorUI
                state={state}
                roomName={roomName}
                onMinimize={toggleMinimized}
                onConnect={handleConnectToggle}
                onDisconnect={handleConnectToggle}
                onCopyLink={copyResetInviteLink}
                onRequestAgent={handleRequestAgent}
              />
              <div className="reset-collaboration-surface__note">
                Mounted directly in the reset shell. Use the archived canvas route only for reference or parity checks.
              </div>
              <div className="reset-inline-actions">
                <a href="/canvas?legacy=1" className="reset-button reset-button--ghost">
                  Open Archived Canvas
                </a>
              </div>
            </div>
            <div className="reset-collaboration-surface__board">
              <div className="reset-frame-title">Reset Board</div>
              <strong>Server-owned TLDraw collaboration</strong>
              <p>Room-aware canvas sync and agent action playback now live inside `/` instead of an iframe bridge.</p>
              <div className="reset-board-stage">
                <TldrawWithCollaboration />
              </div>
            </div>
          </div>
          <RoomAudioRenderer />
        </CanvasLiveKitContext.Provider>
      </ToolDispatcher>
    </RoomScopedProviders>
  );
}

export function ResetCollaborationSurface({
  workspaceSessionId,
  operatorLabel,
  onTelemetryChange,
}: ResetCollaborationSurfaceProps) {
  const [roomOverride, setRoomOverride] = useState<string | null>(null);
  const serverUrl =
    process.env.NEXT_PUBLIC_LIVEKIT_URL ??
    process.env.NEXT_PUBLIC_LK_SERVER_URL ??
    '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextRoom = new URLSearchParams(window.location.search).get('room')?.trim();
    if (nextRoom) {
      setRoomOverride(nextRoom);
    }
  }, []);

  const roomName = useMemo(() => {
    const fallback = `reset-${workspaceSessionId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24)}`;
    return roomOverride || fallback;
  }, [roomOverride, workspaceSessionId]);

  if (!serverUrl) {
    return (
      <div className="reset-collaboration-surface">
        <div className="reset-collaboration-surface__controls">
          <div className="reset-frame-title">Room Controls</div>
          <div className="reset-empty">
            Reset-native board controls are available when `NEXT_PUBLIC_LK_SERVER_URL` is configured.
          </div>
        </div>
        <div className="reset-collaboration-surface__board">
          <div className="reset-frame-title">Reset Board</div>
          <strong>Server-owned TLDraw collaboration</strong>
          <p>Room-aware canvas sync lives in the reset shell. Configure LiveKit to turn on the interactive board.</p>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom connect={false} audio={false} video={false} token={undefined} serverUrl={serverUrl}>
      <ResetCollaborationSurfaceInner
        workspaceSessionId={workspaceSessionId}
        roomName={roomName}
        operatorLabel={operatorLabel}
        onTelemetryChange={onTelemetryChange}
      />
    </LiveKitRoom>
  );
}
