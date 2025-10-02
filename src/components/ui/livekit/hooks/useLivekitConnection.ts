import { useState, useRef, useCallback, useEffect, useMemo, type RefObject } from 'react';
import { ConnectionState, DisconnectReason, Participant, Room } from 'livekit-client';
import type { User } from '@supabase/supabase-js';
import { mergeState as mergeWithFallback } from '@/components/ui/shared/utils/safeSet';
import {
  LivekitRoomConnectorState,
  initialLivekitRoomConnectorState,
} from './types';
import { useAgentDispatch, isAgentParticipant } from './useAgentDispatch';
import type { RoomEventHandlers } from './useRoomEvents';

const TOKEN_TIMEOUT_MS = 15000;
const AUTO_CONNECT_DELAY_MS = 500;
const AGENT_AUTO_TRIGGER_DELAY_MS = 2000;

interface ConnectionOptions {
  room: Room | undefined;
  roomName: string;
  userName: string;
  wsUrl: string;
  audioOnly: boolean;
  autoConnect?: boolean;
  user?: User | null;
  identityRef: RefObject<string | null>;
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
}

interface LivekitConnectionApi {
  state: LivekitRoomConnectorState;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  triggerAgentJoin: () => Promise<void>;
  roomEventHandlers: RoomEventHandlers;
  toggleMinimized: () => void;
}

function resolveInitialState(room?: Room): LivekitRoomConnectorState {
  if (!room) {
    return { ...initialLivekitRoomConnectorState };
  }

  const connectionState =
    room.state === ConnectionState.Connected
      ? 'connected'
      : room.state === ConnectionState.Connecting || room.state === ConnectionState.Reconnecting
        ? 'connecting'
        : 'disconnected';

  return {
    ...initialLivekitRoomConnectorState,
    connectionState,
    participantCount: room.numParticipants,
  };
}

export function useLivekitConnection(options: ConnectionOptions): LivekitConnectionApi {
  const {
    room,
    roomName,
    userName,
    wsUrl,
    audioOnly,
    autoConnect = false,
    user,
    identityRef,
    onConnected,
    onDisconnected,
  } = options;

  const [state, setState] = useState<LivekitRoomConnectorState>(() => resolveInitialState(room));
  const stateRef = useRef(state);
  const tokenFetchInProgress = useRef(false);
  const tokenRequestAbortRef = useRef<AbortController | null>(null);
  const agentAutoTriggerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const mergeConnectorState = useCallback((patch: Partial<LivekitRoomConnectorState>) => {
    setState((prev) => mergeWithFallback(prev, patch, initialLivekitRoomConnectorState));
  }, []);

  const getConnectorState = useCallback(() => stateRef.current, []);

  const toggleMinimized = useCallback(() => {
    setState((prev) => {
      const base = prev ?? initialLivekitRoomConnectorState;
      return {
        ...base,
        isMinimized: !base.isMinimized,
      };
    });
  }, []);

  const clearAgentAutoTrigger = useCallback(() => {
    if (agentAutoTriggerRef.current) {
      clearTimeout(agentAutoTriggerRef.current);
      agentAutoTriggerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    tokenRequestAbortRef.current?.abort();
    tokenRequestAbortRef.current = null;
    clearAgentAutoTrigger();
  }, [clearAgentAutoTrigger]);

  useEffect(() => {
    clearAgentAutoTrigger();
  }, [roomName, clearAgentAutoTrigger]);

  const { triggerAgentJoin: rawTriggerAgentJoin } = useAgentDispatch(
    roomName,
    state.connectionState,
    mergeConnectorState,
    getConnectorState,
  );

  const triggerAgentJoin = useCallback(async () => {
    clearAgentAutoTrigger();
    await rawTriggerAgentJoin();
  }, [clearAgentAutoTrigger, rawTriggerAgentJoin]);

  const scheduleAgentJoin = useCallback(
    (eventRoom: Room) => {
      if (typeof window === 'undefined') {
        return;
      }

      const remoteParticipants = Array.from(eventRoom.remoteParticipants.values());
      const nonAgentParticipants = remoteParticipants.filter((participant) => !isAgentParticipant(participant));
      const agentParticipants = remoteParticipants.filter((participant) => isAgentParticipant(participant));

      if (nonAgentParticipants.length === 0 && agentParticipants.length === 0) {
        clearAgentAutoTrigger();
        agentAutoTriggerRef.current = setTimeout(() => {
          void triggerAgentJoin();
        }, AGENT_AUTO_TRIGGER_DELAY_MS);
      }
    },
    [clearAgentAutoTrigger, triggerAgentJoin],
  );

  const connect = useCallback(async () => {
    if (!room) {
      console.error(`❌ [LiveKitConnector-${roomName}] No room instance available for connect().`);
      mergeConnectorState({
        connectionState: 'error',
        errorMessage: 'LiveKit room is unavailable.',
      });
      return;
    }

    if (!wsUrl) {
      mergeConnectorState({
        connectionState: 'error',
        errorMessage: 'Missing LiveKit server URL. Check your environment variables.',
      });
      return;
    }

    const current = getConnectorState();
    if (current.connectionState === 'connected' || tokenFetchInProgress.current) {
      return;
    }

    mergeConnectorState({
      connectionState: 'connecting',
      errorMessage: null,
      agentStatus: 'not-requested',
      agentIdentity: null,
    });

    tokenFetchInProgress.current = true;
    const abortController = new AbortController();
    tokenRequestAbortRef.current = abortController;

    let identity = identityRef.current;
    if (!identity) {
      const fallback = `${userName.replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
      identityRef.current = fallback;
      identity = fallback;
    }

    const metadataPayload = {
      displayName: userName,
      fullName: userName,
      userId: user?.id ?? undefined,
    };
    const metadataParam = `&metadata=${encodeURIComponent(JSON.stringify(metadataPayload))}`;

    try {
      const tokenResponse = await fetch(
        `/api/token?roomName=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}&username=${encodeURIComponent(userName)}&name=${encodeURIComponent(userName)}${metadataParam}`,
        { signal: abortController.signal },
      );

      if (!tokenResponse.ok) {
        throw new Error(`Token fetch failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
      }

      const data = await tokenResponse.json();
      const token = data.accessToken || data.token;

      if (!token) {
        throw new Error('No token received from API');
      }

      mergeConnectorState({ token });

      const timeoutId = setTimeout(async () => {
        const latest = getConnectorState();
        if (latest.connectionState !== 'connected') {
          try {
            await room.disconnect();
          } catch {
            // ignore disconnect errors during timeout recovery
          }
          mergeConnectorState({
            connectionState: 'error',
            errorMessage: 'Connection timed out.',
          });
        }
      }, TOKEN_TIMEOUT_MS);

      try {
        await room.connect(wsUrl, token);
      } catch (connectError) {
        clearTimeout(timeoutId);
        throw connectError;
      }
      clearTimeout(timeoutId);

      try {
        if (!audioOnly) {
          await room.localParticipant.enableCameraAndMicrophone();
        } else {
          await room.localParticipant.setMicrophoneEnabled(true);
        }
      } catch (mediaError) {
        console.warn(`⚠️ [LiveKitConnector-${roomName}] Media device error:`, mediaError);
      }

      mergeConnectorState({
        connectionState: 'connected',
        participantCount: room.numParticipants,
        errorMessage: null,
      });

      onConnected?.();
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${roomName}] Connection failed:`, error);
      mergeConnectorState({
        connectionState: 'error',
        errorMessage:
          error instanceof Error ? error.message : 'Failed to connect to LiveKit room',
      });
      throw error;
    } finally {
      tokenFetchInProgress.current = false;
      if (tokenRequestAbortRef.current === abortController) {
        tokenRequestAbortRef.current = null;
      }
    }
  }, [
    room,
    roomName,
    wsUrl,
    audioOnly,
    userName,
    user,
    mergeConnectorState,
    getConnectorState,
    identityRef,
    onConnected,
  ]);

  const disconnect = useCallback(async () => {
    if (!room) {
      return;
    }

    try {
      await room.disconnect();
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${roomName}] Error during disconnect:`, error);
    } finally {
      clearAgentAutoTrigger();
      mergeConnectorState({
        connectionState: 'disconnected',
        participantCount: 0,
        agentStatus: 'not-requested',
        agentIdentity: null,
        errorMessage: null,
        token: null,
      });
      onDisconnected?.();
    }
  }, [room, roomName, mergeConnectorState, onDisconnected, clearAgentAutoTrigger]);

  useEffect(() => {
    if (!autoConnect) {
      return;
    }

    const timer = setTimeout(() => {
      const latest = getConnectorState();
      if (latest.connectionState === 'disconnected') {
        void connect();
      }
    }, AUTO_CONNECT_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [autoConnect, connect, getConnectorState]);

  useEffect(() => {
    if (!room) {
      return;
    }

    const connectionState =
      room.state === ConnectionState.Connected
        ? 'connected'
        : room.state === ConnectionState.Connecting || room.state === ConnectionState.Reconnecting
          ? 'connecting'
          : 'disconnected';

    const participantCount = room.numParticipants;
    const current = getConnectorState();

    if (
      current.connectionState === 'disconnected' &&
      (current.connectionState !== connectionState || current.participantCount !== participantCount)
    ) {
      mergeConnectorState({
        connectionState,
        participantCount,
      });
    }
  }, [room, mergeConnectorState, getConnectorState]);

  const handleRoomConnected = useCallback(
    (eventRoom: Room) => {
      mergeConnectorState({
        connectionState: 'connected',
        participantCount: eventRoom.numParticipants,
        errorMessage: null,
      });
      scheduleAgentJoin(eventRoom);
    },
    [mergeConnectorState, scheduleAgentJoin],
  );

  const handleRoomDisconnected = useCallback(
    (_eventRoom: Room, reason?: DisconnectReason) => {
      clearAgentAutoTrigger();
      mergeConnectorState({
        connectionState: 'disconnected',
        participantCount: 0,
        errorMessage: reason ? `Disconnected: ${reason}` : null,
        agentStatus: 'not-requested',
        agentIdentity: null,
        token: null,
      });
    },
    [clearAgentAutoTrigger, mergeConnectorState],
  );

  const handleRoomReconnecting = useCallback(() => {
    clearAgentAutoTrigger();
    mergeConnectorState({
      connectionState: 'connecting',
      errorMessage: 'Reconnecting...',
    });
  }, [clearAgentAutoTrigger, mergeConnectorState]);

  const handleRoomReconnected = useCallback(
    (eventRoom: Room) => {
      mergeConnectorState({
        connectionState: 'connected',
        participantCount: eventRoom.numParticipants,
        errorMessage: null,
      });
      scheduleAgentJoin(eventRoom);
    },
    [mergeConnectorState, scheduleAgentJoin],
  );

  const handleParticipantConnected = useCallback(
    (eventRoom: Room, participant: Participant) => {
      clearAgentAutoTrigger();
      if (isAgentParticipant(participant)) {
        mergeConnectorState({
          participantCount: eventRoom.numParticipants,
          agentStatus: 'joined',
          agentIdentity: participant.identity,
          errorMessage: null,
        });
      } else {
        mergeConnectorState({
          participantCount: eventRoom.numParticipants,
        });
      }
    },
    [clearAgentAutoTrigger, mergeConnectorState],
  );

  const handleParticipantDisconnected = useCallback(
    (eventRoom: Room, participant: Participant) => {
      if (isAgentParticipant(participant) && getConnectorState().agentIdentity === participant.identity) {
        mergeConnectorState({
          participantCount: eventRoom.numParticipants,
          agentStatus: 'not-requested',
          agentIdentity: null,
        });
        scheduleAgentJoin(eventRoom);
      } else {
        mergeConnectorState({
          participantCount: eventRoom.numParticipants,
        });
      }
    },
    [getConnectorState, mergeConnectorState, scheduleAgentJoin],
  );

  const roomEventHandlers = useMemo<RoomEventHandlers>(
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

  return {
    state,
    connect,
    disconnect,
    triggerAgentJoin,
    roomEventHandlers,
    toggleMinimized,
  };
}
