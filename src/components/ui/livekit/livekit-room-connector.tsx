'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { z } from 'zod';
import { useRoomContext, AudioConference } from '@livekit/components-react';
import { isDefaultCanvasUser } from '@/lib/livekit/display-names';
import { useAuth } from '@/hooks/use-auth';
import { ConnectionState } from 'livekit-client';

// Extracted hooks
import { useLivekitConnection } from './hooks/useLivekitConnection';
import { useAgentDispatch } from './hooks/useAgentDispatch';
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

type LivekitRoomConnectorState = {
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  isMinimized: boolean;
  participantCount: number;
  errorMessage: string | null;
  token: string | null;
  agentStatus: 'not-requested' | 'dispatching' | 'joined' | 'failed';
  agentIdentity: string | null;
};

export const CanvasLiveKitContext = React.createContext<{
  isConnected: boolean;
  roomName: string;
  participantCount: number;
} | null>(null);

function getInitialState(room?: any): LivekitRoomConnectorState {
  if (!room) {
    return {
      connectionState: 'disconnected',
      isMinimized: false,
      participantCount: 0,
      errorMessage: null,
      token: null,
      agentStatus: 'not-requested',
      agentIdentity: null,
    };
  }

  const connectionState =
    room.state === ConnectionState.Connected
      ? 'connected'
      : room.state === ConnectionState.Connecting || room.state === ConnectionState.Reconnecting
        ? 'connecting'
        : 'disconnected';

  return {
    connectionState,
    isMinimized: false,
    participantCount: room.numParticipants,
    errorMessage: null,
    token: null,
    agentStatus: 'not-requested',
    agentIdentity: null,
  };
}

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

  const [state, setState] = React.useState<LivekitRoomConnectorState | null>(getInitialState(room));
  const stateRef = React.useRef<LivekitRoomConnectorState | null>(state);
  stateRef.current = state;
  
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
  const { triggerAgentJoin } = useAgentDispatch(
    room,
    roomName,
    state?.connectionState || 'disconnected',
    setState,
    stateRef,
  );

  useRoomEvents(room, roomName, setState, stateRef, triggerAgentJoin);

  useLivekitConnection(
    room,
    {
      roomName,
      userName: effectiveUserName,
      wsUrl,
      audioOnly,
      user,
      identityRef,
    },
    stateRef,
  );

  // Auto-connect
  React.useEffect(() => {
    if (!autoConnect || !stateRef.current || stateRef.current.connectionState !== 'disconnected') {
      return;
    }
    const connectTimer = setTimeout(() => {
      handleConnect();
    }, 1000);
    return () => clearTimeout(connectTimer);
  }, [autoConnect, stateRef.current?.connectionState]);

  const handleConnect = () => {
    console.log(`🔌 [LiveKitConnector-${roomName}] handleConnect called`);
    if (!state || !room) return;
    if (!wsUrl && state.connectionState === 'disconnected') {
      setState((prev: any) => ({
        ...prev,
        connectionState: 'error',
        errorMessage: 'Missing LiveKit server URL. Check your environment variables.',
      }));
      return;
    }

    if (state.connectionState === 'disconnected') {
      setState((prev: any) => ({
        ...prev,
        connectionState: 'connecting',
        errorMessage: null,
        agentStatus: 'not-requested',
        agentIdentity: null,
      }));
    } else if (state.connectionState === 'connected') {
      try {
        room.disconnect();
        setState((prev: any) => ({
          ...prev,
          connectionState: 'disconnected',
          participantCount: 0,
          agentStatus: 'not-requested',
          agentIdentity: null,
          errorMessage: null,
        }));
      } catch (error) {
        console.error(`❌ [LiveKitConnector-${roomName}] Error during disconnect:`, error);
      }
    }
  };

  const handleMinimize = () => {
    setState((prev: any) => ({
      ...prev,
      isMinimized: !prev.isMinimized,
    }));
  };

  const handleCopyLink = () => {
    const id = roomName.startsWith('canvas-') ? roomName.substring('canvas-'.length) : roomName;
    const link = `${window.location.origin}/canvas?id=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(link);
  };

  return (
    <>
      <RoomConnectorUI
        state={state || null}
        roomName={roomName}
        onMinimize={handleMinimize}
        onConnect={handleConnect}
        onDisconnect={handleConnect}
        onCopyLink={handleCopyLink}
      />

      {state?.connectionState === 'connected' && (
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
