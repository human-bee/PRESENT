import { useCallback, useEffect, useMemo } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, Room } from 'livekit-client';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/hooks/use-auth';
import { isDefaultCanvasUser } from '@/lib/livekit/display-names';
import type { RoomEventHandlers } from './useRoomEvents';
import type { LivekitRoomConnectorState } from './utils/lk-types';
import { initialLivekitRoomConnectorState } from './utils/lk-types';
import { useLkState } from './useLkState';
import { useLkToken } from './useLkToken';
import { useLkAutoConnect } from './useLkAutoConnect';
import { useLkAgentRequest } from './useLkAgentRequest';
import { useLkRoomHandlers } from './useLkRoomHandlers';
import { useLkIdentity } from './useLkIdentity';

export interface UseLivekitConnectionOptions {
  roomName?: string;
  userName?: string;
  serverUrl?: string;
  audioOnly?: boolean;
  autoConnect?: boolean;
  publishLocalMedia?: boolean;
  autoRequestAgent?: boolean;
}

export interface LivekitConnectionApi {
  state: LivekitRoomConnectorState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  requestAgent: () => Promise<void>;
  toggleMinimized: () => void;
  copyInviteLink: () => Promise<void>;
  roomEventHandlers: RoomEventHandlers;
  room: Room | undefined;
  roomName: string;
  displayName: string;
}

function resolveInitialState(room?: Room | null): LivekitRoomConnectorState {
  if (!room) {
    return { ...initialLivekitRoomConnectorState };
  }

  const connectionState =
    room.state === ConnectionState.Connected
      ? 'connected'
      : room.state === ConnectionState.Reconnecting
        ? 'reconnecting'
        : room.state === ConnectionState.Connecting
          ? 'connecting'
          : 'disconnected';

  return {
    ...initialLivekitRoomConnectorState,
    connectionState,
    participantCount: room.numParticipants,
  };
}

function resolveDisplayName(userName: string, user: User | null): string {
  const provided = userName.trim();
  if (provided && !isDefaultCanvasUser(provided)) {
    return provided;
  }

  const profileName =
    typeof user?.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name.trim()
      : '';
  if (profileName) {
    return profileName;
  }

  const emailName = typeof user?.email === 'string' ? user.email.split('@')[0]?.trim() ?? '' : '';
  if (emailName) {
    return emailName;
  }

  return provided || 'Canvas User';
}

export function useLivekitConnection(options: UseLivekitConnectionOptions): LivekitConnectionApi {
  const {
    roomName: providedRoomName = 'canvas-room',
    userName: providedUserName = 'Canvas User',
    serverUrl,
    audioOnly = false,
    autoConnect = false,
    publishLocalMedia = true,
    autoRequestAgent = true,
  } = options;

  const { user } = useAuth();
  const room = useRoomContext();

  const displayName = useMemo(
    () => resolveDisplayName(providedUserName, user ?? null),
    [providedUserName, user],
  );

  const wsUrl = useMemo(() => {
    return (
      serverUrl ||
      process.env.NEXT_PUBLIC_LIVEKIT_URL ||
      process.env.NEXT_PUBLIC_LK_SERVER_URL ||
      ''
    );
  }, [serverUrl]);

  const ensureIdentity = useLkIdentity(displayName, providedRoomName);

  const {
    state,
    mergeState,
    toggleMinimized,
    getState,
  } = useLkState(resolveInitialState(room ?? null));

  useEffect(() => {
    mergeState(resolveInitialState(room ?? null));
  }, [room, mergeState]);

  const {
    requestAgent,
    scheduleAgentJoin,
    clearAgentAutoTrigger,
  } = useLkAgentRequest({
    roomName: providedRoomName,
    connectionState: state.connectionState,
    mergeState,
    getState,
    autoRequestEnabled: autoRequestAgent,
  });

  const { connect, disconnect } = useLkToken({
    room: room ?? undefined,
    roomName: providedRoomName,
    wsUrl,
    displayName,
    user: user ?? null,
    audioOnly,
    publishLocalMedia,
    ensureIdentity,
    mergeState,
    getState,
    scheduleAgentJoin,
    clearAgentAutoTrigger,
  });

  useLkAutoConnect({ autoConnect, connect, getState });

  useEffect(() => {
    clearAgentAutoTrigger();
  }, [providedRoomName, displayName, clearAgentAutoTrigger]);

  useEffect(() => {
    if (!room) {
      return;
    }

    const connectionState =
      room.state === ConnectionState.Connected
        ? 'connected'
        : room.state === ConnectionState.Reconnecting
          ? 'reconnecting'
          : room.state === ConnectionState.Connecting
            ? 'connecting'
            : 'disconnected';

    const participantCount = room.numParticipants;
    const current = getState();

    if (
      current.connectionState === 'disconnected' &&
      (current.connectionState !== connectionState || current.participantCount !== participantCount)
    ) {
      mergeState({ connectionState, participantCount });
    }
  }, [room, mergeState, getState]);

  const roomEventHandlers = useLkRoomHandlers({
    mergeState,
    scheduleAgentJoin,
    clearAgentAutoTrigger,
    getState,
  });

  const copyInviteLink = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    const id = providedRoomName.startsWith('canvas-')
      ? providedRoomName.substring('canvas-'.length)
      : providedRoomName;
    const link = `${window.location.origin}/canvas?id=${encodeURIComponent(id)}`;

    try {
      await navigator.clipboard.writeText(link);
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${providedRoomName}] Failed to copy invite link:`, error);
    }
  }, [providedRoomName]);

  return {
    state,
    connect,
    disconnect,
    requestAgent,
    toggleMinimized,
    copyInviteLink,
    roomEventHandlers,
    room: room ?? undefined,
    roomName: providedRoomName,
    displayName,
  };
}
