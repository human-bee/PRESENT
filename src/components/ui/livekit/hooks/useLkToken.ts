import { useCallback, useEffect, useRef } from 'react';
import type { Room } from 'livekit-client';
import type { User } from '@supabase/supabase-js';
import { connectRoomWithToken } from './utils/lk-connect';
import { buildMetadataParam, fetchLivekitAccessToken } from './utils/lk-token';
import type { LivekitRoomConnectorState } from './utils/lk-types';

interface UseLkTokenParams {
  room: Room | undefined;
  roomName: string;
  wsUrl: string;
  displayName: string;
  user: User | null | undefined;
  audioOnly: boolean;
  ensureIdentity: () => string;
  mergeState: (patch: Partial<LivekitRoomConnectorState>) => void;
  getState: () => LivekitRoomConnectorState;
  scheduleAgentJoin: (room: Room) => void;
  clearAgentAutoTrigger: () => void;
}

export interface LivekitTokenApi {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useLkToken(params: UseLkTokenParams): LivekitTokenApi {
  const {
    room,
    roomName,
    wsUrl,
    displayName,
    user,
    audioOnly,
    ensureIdentity,
    mergeState,
    getState,
    scheduleAgentJoin,
    clearAgentAutoTrigger,
  } = params;

  const tokenFetchInProgressRef = useRef(false);
  const tokenRequestAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      tokenRequestAbortRef.current?.abort();
      tokenRequestAbortRef.current = null;
      clearAgentAutoTrigger();
    };
  }, [clearAgentAutoTrigger]);

  const connect = useCallback(async () => {
    if (!room) {
      mergeState({ connectionState: 'error', errorMessage: 'LiveKit room is unavailable.' });
      return;
    }

    if (!wsUrl) {
      mergeState({
        connectionState: 'error',
        errorMessage: 'Missing LiveKit server URL. Check your environment variables.',
      });
      return;
    }

    const current = getState();
    if (current.connectionState === 'connected' || tokenFetchInProgressRef.current) {
      return;
    }

    mergeState({
      connectionState: 'connecting',
      errorMessage: null,
      agentStatus: 'not-requested',
      agentIdentity: null,
    });

    tokenFetchInProgressRef.current = true;
    tokenRequestAbortRef.current?.abort();
    const abortController = new AbortController();
    tokenRequestAbortRef.current = abortController;

    const identity = ensureIdentity();
    const metadataParam = buildMetadataParam(displayName, user);

    try {
      const token = await fetchLivekitAccessToken({
        roomName,
        identity,
        displayName,
        metadataParam,
        signal: abortController.signal,
      });

      mergeState({ token });

      await connectRoomWithToken({
        room,
        wsUrl,
        token,
        audioOnly,
        roomName,
        mergeState,
        getState,
        scheduleAgentJoin,
      });
    } catch (error) {
      console.error(`❌ [LiveKitConnector-${roomName}] Connection failed:`, error);
      mergeState({
        connectionState: 'error',
        errorMessage: error instanceof Error ? error.message : 'Failed to connect to LiveKit room',
      });
      throw error;
    } finally {
      tokenFetchInProgressRef.current = false;
      if (tokenRequestAbortRef.current === abortController) {
        tokenRequestAbortRef.current = null;
      }
    }
  }, [
    room,
    roomName,
    wsUrl,
    audioOnly,
    displayName,
    user,
    ensureIdentity,
    mergeState,
    getState,
    scheduleAgentJoin,
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
      mergeState({
        connectionState: 'disconnected',
        participantCount: 0,
        agentStatus: 'not-requested',
        agentIdentity: null,
        errorMessage: null,
        token: null,
      });
    }
  }, [room, roomName, mergeState, clearAgentAutoTrigger]);

  return { connect, disconnect };
}
