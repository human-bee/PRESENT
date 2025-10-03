import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type RefObject,
} from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionState, DisconnectReason, Participant, Room } from 'livekit-client';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '@/hooks/use-auth';
import { isDefaultCanvasUser } from '@/lib/livekit/display-names';
import { mergeState, produceState } from '@/components/ui/shared/utils/state';
import {
  LivekitRoomConnectorState,
  initialLivekitRoomConnectorState,
} from './types';
import { useAgentDispatch, isAgentParticipant } from './useAgentDispatch';
import type { RoomEventHandlers } from './useRoomEvents';
import {
  TOKEN_TIMEOUT_MS,
  AUTO_CONNECT_DELAY_MS,
  AGENT_AUTO_TRIGGER_DELAY_MS,
  STORAGE_KEY_PREFIX,
} from '../utils';

export interface UseLivekitConnectionOptions {
  roomName?: string;
  userName?: string;
  serverUrl?: string;
  audioOnly?: boolean;
  autoConnect?: boolean;
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

function createSlug(source: string): string {
  return source.replace(/\s+/g, '-').slice(0, 24) || 'user';
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

function ensureIdentity(
  identityRef: RefObject<string | null>,
  displayName: string,
  roomName: string,
): string {
  const existing = identityRef.current;
  if (existing) {
    return existing;
  }

  const base = createSlug(displayName || 'user');
  const generated = `${base}-${Math.random().toString(36).slice(2, 8)}`;
  identityRef.current = generated;

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${roomName}`, generated);
    } catch {
      // ignore storage failures
    }
  }

  return generated;
}

export function useLivekitConnection(options: UseLivekitConnectionOptions): LivekitConnectionApi {
  const {
    roomName: providedRoomName = 'canvas-room',
    userName: providedUserName = 'Canvas User',
    serverUrl,
    audioOnly = false,
    autoConnect = false,
  } = options;

  const { user } = useAuth();
  const room = useRoomContext();

  const displayName = useMemo(
    () => resolveDisplayName(providedUserName, user ?? null),
    [providedUserName, user],
  );

  const identityRef = useRef<string | null>(null);
  const stateRef = useRef<LivekitRoomConnectorState>(initialLivekitRoomConnectorState);
  const tokenFetchInProgress = useRef(false);
  const tokenRequestAbortRef = useRef<AbortController | null>(null);
  const agentAutoTriggerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<LivekitRoomConnectorState>(() => resolveInitialState(room ?? undefined));

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      ensureIdentity(identityRef, displayName, providedRoomName);
      return;
    }

    const storageKey = `${STORAGE_KEY_PREFIX}${providedRoomName}`;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        identityRef.current = stored;
        return;
      }
    } catch {
      // ignore storage access failures and fall back to generated id
    }

    ensureIdentity(identityRef, displayName, providedRoomName);
  }, [providedRoomName, displayName]);

  const wsUrl = useMemo(() => {
    return (
      serverUrl ||
      process.env.NEXT_PUBLIC_LIVEKIT_URL ||
      process.env.NEXT_PUBLIC_LK_SERVER_URL ||
      ''
    );
  }, [serverUrl]);

  const mergeConnectorState = useCallback(
    (patch: Partial<LivekitRoomConnectorState>) => {
      setState((prev) => mergeState(prev, patch, initialLivekitRoomConnectorState));
    },
    [],
  );

  const getConnectorState = useCallback(() => stateRef.current, []);

  const toggleMinimized = useCallback(() => {
    setState((prev) =>
      produceState(prev, (draft) => {
        draft.isMinimized = !draft.isMinimized;
      }, initialLivekitRoomConnectorState),
    );
  }, []);

  const clearAgentAutoTrigger = useCallback(() => {
    if (agentAutoTriggerRef.current) {
      clearTimeout(agentAutoTriggerRef.current);
      agentAutoTriggerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      tokenRequestAbortRef.current?.abort();
      tokenRequestAbortRef.current = null;
      clearAgentAutoTrigger();
    };
  }, [clearAgentAutoTrigger]);

  useEffect(() => {
    clearAgentAutoTrigger();
  }, [providedRoomName, displayName, clearAgentAutoTrigger]);

  const { requestAgent: rawRequestAgent } = useAgentDispatch(
    providedRoomName,
    state.connectionState,
    mergeConnectorState,
    getConnectorState,
  );

  const requestAgent = useCallback(async () => {
    clearAgentAutoTrigger();
    await rawRequestAgent();
  }, [clearAgentAutoTrigger, rawRequestAgent]);

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
          void requestAgent();
        }, AGENT_AUTO_TRIGGER_DELAY_MS);
      }
    },
    [clearAgentAutoTrigger, requestAgent],
  );

  const connect = useCallback(async () => {
    if (!room) {
      console.error(`❌ [LiveKitConnector-${providedRoomName}] No room instance available for connect().`);
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
    tokenRequestAbortRef.current?.abort();
    const abortController = new AbortController();
    tokenRequestAbortRef.current = abortController;

    const identity = ensureIdentity(identityRef, displayName, providedRoomName);

    const metadataPayload = {
      displayName,
      fullName: displayName,
      userId: user?.id ?? undefined,
    };
    const metadataParam = `&metadata=${encodeURIComponent(JSON.stringify(metadataPayload))}`;

    try {
      const tokenResponse = await fetch(
        `/api/token?roomName=${encodeURIComponent(providedRoomName)}&identity=${encodeURIComponent(identity)}&username=${encodeURIComponent(displayName)}&name=${encodeURIComponent(displayName)}${metadataParam}`,
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
        console.warn(`⚠️ [LiveKitConnector-${providedRoomName}] Media device error:`, mediaError);
      }

      mergeConnectorState({
        connectionState: 'connected',
        participantCount: room.numParticipants,
        errorMessage: null,
      });

      scheduleAgentJoin(room);
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${providedRoomName}] Connection failed:`, error);
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
    providedRoomName,
    wsUrl,
    audioOnly,
    displayName,
    user,
    mergeConnectorState,
    getConnectorState,
    scheduleAgentJoin,
  ]);

  const disconnect = useCallback(async () => {
    if (!room) {
      return;
    }

    try {
      await room.disconnect();
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${providedRoomName}] Error during disconnect:`, error);
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
    }
  }, [room, providedRoomName, mergeConnectorState, clearAgentAutoTrigger]);

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
