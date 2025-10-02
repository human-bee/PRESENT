'use client';

import * as React from 'react';
import { z } from 'zod';
import { useRoomContext, AudioConference } from '@livekit/components-react';
import { isDefaultCanvasUser } from '@/lib/livekit/display-names';
import { useAuth } from '@/hooks/use-auth';

// Extracted hooks
import { useLivekitConnection } from './hooks/useLivekitConnection';
import { useRoomEvents } from './hooks/useRoomEvents';

// Import the UI component (we'll extract this separately)
import { RoomConnectorUI } from './components/RoomConnectorUI';

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
  roomName = 'canvas-room',
  userName = 'Canvas User',
  serverUrl,
  audioOnly = false,
  autoConnect = false,
}: LivekitRoomConnectorProps) {
  const room = useRoomContext();
  const { user } = useAuth();

  const effectiveUserName = React.useMemo(() => {
    const provided = (userName ?? '').trim();
    if (provided && !isDefaultCanvasUser(provided)) return provided;
    const profileName = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
    if (profileName) return profileName;
    const emailName = typeof user?.email === 'string' ? user.email.split('@')[0]?.trim() ?? '' : '';
    if (emailName) return emailName;
    return provided || 'Canvas User';
  }, [userName, user]);

  const identityRef = React.useRef<string | null>(null);
  const wsUrl = serverUrl || process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.NEXT_PUBLIC_LK_SERVER_URL || '';

  // Generate stable identity
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const key = `present:lk:identity:${roomName}`;
      let id = window.localStorage.getItem(key);
      if (!id) {
        const base = (effectiveUserName || 'user').replace(/\s+/g, '-').slice(0, 24);
        const rand = Math.random().toString(36).slice(2, 8);
        id = `${base}-${rand}`;
        window.localStorage.setItem(key, id);
      }
      identityRef.current = id;
    } catch {
      const base = (effectiveUserName || 'user').replace(/\s+/g, '-').slice(0, 24);
      const rand = Math.random().toString(36).slice(2, 8);
      identityRef.current = `${base}-${rand}`;
    }
  }, [roomName, effectiveUserName]);

  // Use extracted hooks
  const {
    state,
    connect,
    disconnect,
    triggerAgentJoin,
    roomEventHandlers,
    toggleMinimized,
  } = useLivekitConnection({
    room,
    roomName,
    userName: effectiveUserName,
    wsUrl,
    audioOnly,
    autoConnect,
    user,
    identityRef,
  });
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

  const handleMinimize = React.useCallback(() => {
    toggleMinimized();
  }, [toggleMinimized]);

  const handleRequestAgent = React.useCallback(() => {
    if (state.connectionState === 'connected') {
      void triggerAgentJoin();
    }
  }, [state.connectionState, triggerAgentJoin]);

  const handleCopyLink = () => {
    const id = roomName.startsWith('canvas-') ? roomName.substring('canvas-'.length) : roomName;
    const link = `${window.location.origin}/canvas?id=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(link);
  };

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
