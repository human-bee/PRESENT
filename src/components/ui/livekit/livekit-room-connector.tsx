'use client';

import * as React from 'react';
import { z } from 'zod';
import { AudioConference } from '@livekit/components-react';
import { useLivekitConnection, useRoomEvents } from './hooks';
import { RoomConnectorUI } from './components';

export const livekitRoomConnectorSchema = z.object({
  roomName: z.string().optional().describe("Name of the room to join (default: 'canvas-room')"),
  userName: z.string().optional().describe("User's display name (default: 'Canvas User')"),
  serverUrl: z.string().optional().describe('LiveKit server URL (uses environment variable if not provided)'),
  audioOnly: z.boolean().optional().describe('Whether to join in audio-only mode (default: false)'),
  autoConnect: z.boolean().optional().describe('Whether to automatically connect on mount (default: false)'),
});

export type LivekitRoomConnectorProps = z.infer<typeof livekitRoomConnectorSchema>;

export const CanvasLiveKitContext = React.createContext<{
  isConnected: boolean;
  roomName: string;
  participantCount: number;
} | null>(null);

export function LivekitRoomConnector({
  roomName: providedRoomName,
  userName: providedUserName,
  serverUrl,
  audioOnly = false,
  autoConnect = false,
}: LivekitRoomConnectorProps) {
  // In canvas, the canonical room name is computed by CanvasPageClient (canvas-<uuid>).
  // If callers don't pass roomName explicitly, prefer the canvas context to avoid dispatching
  // the voice agent to the wrong room (and timing out waiting for it to join).
  const livekitCtx = React.useContext(CanvasLiveKitContext);
  const roomName = providedRoomName ?? livekitCtx?.roomName ?? 'canvas-room';
  const userName = providedUserName ?? 'Canvas User';

  const {
    state,
    connect,
    disconnect,
    requestAgent,
    toggleMinimized,
    copyInviteLink,
    roomEventHandlers,
    room,
  } = useLivekitConnection({ roomName, userName, serverUrl, audioOnly, autoConnect });

  useRoomEvents(room, roomName, roomEventHandlers);

  const handleConnectToggle = React.useCallback(() => {
    if (state.connectionState === 'connected') {
      void disconnect();
      return;
    }

    if (state.connectionState === 'disconnected' || state.connectionState === 'error') {
      void connect();
    }
  }, [state.connectionState, connect, disconnect]);

  const handleMinimize = toggleMinimized;

  const handleRequestAgent = React.useCallback(() => {
    if (state.connectionState === 'connected') {
      void requestAgent();
    }
  }, [state.connectionState, requestAgent]);

  const handleCopyLink = React.useCallback(() => {
    void copyInviteLink();
  }, [copyInviteLink]);

  return (
    <>
      <RoomConnectorUI
        state={state}
        roomName={roomName}
        onMinimize={handleMinimize}
        onConnect={handleConnectToggle}
        onDisconnect={handleConnectToggle}
        onCopyLink={handleCopyLink}
        onRequestAgent={handleRequestAgent}
      />

      {state.connectionState === 'connected' && (
        <div className="hidden">
          <AudioConference />
        </div>
      )}
    </>
  );
}

export function useCanvasLiveKit() {
  const context = React.useContext(CanvasLiveKitContext);
  return context;
}

export default LivekitRoomConnector;
