'use client';

import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';

type SessionSyncInfo = {
  sessionId: string | null;
  roomName: string;
};

type ExecutorApiResponse = {
  acquired?: boolean;
  ok?: boolean;
  executorIdentity?: string | null;
  leaseExpiresAt?: string | null;
};

export type RoomExecutorState = {
  sessionId: string | null;
  isExecutor: boolean;
  executorIdentity: string | null;
  leaseExpiresAt: string | null;
  status: 'idle' | 'claiming' | 'active' | 'standby' | 'error';
  error: string | null;
};

const CLAIM_INTERVAL_MS = 5_000;
const LEASE_TTL_MS = 15_000;

function readSessionSyncInfo(): SessionSyncInfo {
  if (typeof window === 'undefined') {
    return { sessionId: null, roomName: '' };
  }
  const sync = (window as any)?.__present?.sessionSync;
  return {
    sessionId: typeof sync?.sessionId === 'string' ? sync.sessionId : null,
    roomName: typeof sync?.roomName === 'string' ? sync.roomName : '',
  };
}

function publishExecutorState(state: RoomExecutorState) {
  if (typeof window === 'undefined') return;
  try {
    const w = window as any;
    w.__present = w.__present || {};
    w.__present.executor = {
      ...state,
      updatedAt: Date.now(),
    };
    window.dispatchEvent(
      new CustomEvent('present:executor-state', {
        detail: w.__present.executor,
      }),
    );
  } catch {
    // noop
  }
}

async function postExecutor(
  path: string,
  payload: Record<string, unknown>,
): Promise<ExecutorApiResponse> {
  const res = await fetchWithSupabaseAuth(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: path.endsWith('/release'),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Executor request failed: ${res.status}`);
  }
  return (await res.json()) as ExecutorApiResponse;
}

export function useRoomExecutor(room?: Room) {
  const [state, setState] = useState<RoomExecutorState>({
    sessionId: null,
    isExecutor: false,
    executorIdentity: null,
    leaseExpiresAt: null,
    status: 'idle',
    error: null,
  });
  const sessionRef = useRef<SessionSyncInfo>(readSessionSyncInfo());
  const inFlightRef = useRef(false);
  const isExecutorRef = useRef(state.isExecutor);
  const tickRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    isExecutorRef.current = state.isExecutor;
  }, [state.isExecutor]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const releaseLease = (sessionId: string, roomName: string, identity: string) => {
      if (!sessionId || !identity) return;
      void postExecutor('/api/session/executor/release', {
        sessionId,
        roomName,
        identity,
      }).catch(() => {
        // noop
      });
    };

    const updateSession = () => {
      const previous = sessionRef.current;
      const next = readSessionSyncInfo();
      const identity = room?.localParticipant?.identity || '';
      const previousRoomName = previous.roomName || room?.name || '';
      if (
        isExecutorRef.current &&
        identity &&
        previous.sessionId &&
        previous.sessionId !== next.sessionId
      ) {
        releaseLease(previous.sessionId, previousRoomName, identity);
      }
      sessionRef.current = next;
      setState((prev) => ({
        ...prev,
        sessionId: next.sessionId,
      }));
      void tickRef.current?.();
    };
    updateSession();
    window.addEventListener('present:session-sync', updateSession as EventListener);
    return () => {
      window.removeEventListener('present:session-sync', updateSession as EventListener);
    };
  }, [room]);

  useEffect(() => {
    publishExecutorState(state);
  }, [state]);

  useEffect(() => {
    if (!room) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (!active) return;
      if (inFlightRef.current) {
        timer = setTimeout(() => void tick(), CLAIM_INTERVAL_MS);
        return;
      }
      const sessionId = sessionRef.current.sessionId;
      const roomName = sessionRef.current.roomName || room.name || '';
      const identity = room.localParticipant?.identity || '';
      const connected = room.state === 'connected';

      if (!sessionId || !roomName || !identity || !connected) {
        setState((prev) => ({
          ...prev,
          sessionId: sessionId ?? null,
          status: 'idle',
          isExecutor: false,
          error: null,
        }));
        timer = setTimeout(() => void tick(), CLAIM_INTERVAL_MS);
        return;
      }

      inFlightRef.current = true;
      try {
        const endpoint = state.isExecutor
          ? '/api/session/executor/heartbeat'
          : '/api/session/executor/claim';
        const response = await postExecutor(endpoint, {
          sessionId,
          roomName,
          identity,
          leaseTtlMs: LEASE_TTL_MS,
        });
        const executorIdentity =
          typeof response.executorIdentity === 'string'
            ? response.executorIdentity
            : null;
        const leaseExpiresAt =
          typeof response.leaseExpiresAt === 'string'
            ? response.leaseExpiresAt
            : null;
        const isExecutor =
          Boolean(response.acquired ?? response.ok) &&
          executorIdentity === identity;
        setState((prev) => ({
          ...prev,
          sessionId,
          isExecutor,
          executorIdentity,
          leaseExpiresAt,
          status: isExecutor ? 'active' : 'standby',
          error: null,
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          sessionId,
          isExecutor: false,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        inFlightRef.current = false;
        if (active) timer = setTimeout(() => void tick(), CLAIM_INTERVAL_MS);
      }
    };
    tickRef.current = tick;

    void tick();

    const release = () => {
      const sessionId = sessionRef.current.sessionId;
      const roomName = sessionRef.current.roomName || room.name || '';
      const identity = room.localParticipant?.identity || '';
      if (!sessionId || !identity) return;
      void postExecutor('/api/session/executor/release', {
        sessionId,
        roomName,
        identity,
      }).catch(() => {
        // noop
      });
    };

    const onUnload = () => release();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      tickRef.current = null;
      window.removeEventListener('beforeunload', onUnload);
      if (state.isExecutor) {
        release();
      }
    };
  }, [room, state.isExecutor]);

  return state;
}

export default useRoomExecutor;
