'use client';

import { useEffect, useState } from 'react';
import type { Participant, Room } from 'livekit-client';

export interface CanvasRoomHostState {
  isHost: boolean;
  hostId: string | null;
}

interface UseCanvasRoomHostOptions {
  allowStandaloneHost?: boolean;
}

type HostParticipantLike = Pick<Participant, 'identity' | 'sid' | 'name'> & {
  isAgent?: boolean;
  permissions?: { agent?: boolean } | null;
};

type RoomLike = {
  localParticipant?: HostParticipantLike;
  remoteParticipants: Map<string, HostParticipantLike>;
  state?: string;
};

const getParticipantId = (participant: Participant | undefined) =>
  participant?.identity || participant?.sid || '';

const isAgentParticipant = (participant: Participant | undefined) => {
  const flagged = Boolean((participant as any)?.isAgent || (participant as any)?.permissions?.agent);
  if (flagged) return true;
  const identity = String(participant?.identity || participant?.name || '').toLowerCase();
  if (!identity) return false;
  return identity.startsWith('agent-') || identity.includes('voice-agent');
};

const getEligibleId = (participant: Participant | undefined) => {
  if (!participant || isAgentParticipant(participant)) return '';
  return getParticipantId(participant);
};

export function resolveCanvasRoomHostState(
  room?: RoomLike,
  options: UseCanvasRoomHostOptions = {},
): CanvasRoomHostState {
  const { allowStandaloneHost = false } = options;

  if (!room) {
    return { isHost: allowStandaloneHost, hostId: null };
  }

  if (room.state && room.state !== 'connected' && !allowStandaloneHost) {
    return { isHost: false, hostId: null };
  }

  const localId = getEligibleId(room.localParticipant as Participant | undefined);
  const ids: string[] = [];
  if (localId) {
    ids.push(localId);
  }
  room.remoteParticipants.forEach((participant) => {
    const id = getEligibleId(participant as Participant | undefined);
    if (id) ids.push(id);
  });

  ids.sort();
  if (ids.length === 0) {
    return { isHost: false, hostId: null };
  }

  return {
    isHost: localId ? ids[0] === localId : false,
    hostId: ids[0] ?? null,
  };
}

export function useCanvasRoomHost(
  room?: Room,
  options: UseCanvasRoomHostOptions = {},
) {
  const { allowStandaloneHost = false } = options;
  const [hasSeenConnected, setHasSeenConnected] = useState(Boolean(room?.state === 'connected'));
  const [hostState, setHostState] = useState<CanvasRoomHostState>(() =>
    resolveCanvasRoomHostState(room, { allowStandaloneHost: allowStandaloneHost && !hasSeenConnected }),
  );

  useEffect(() => {
    const recompute = () => {
      if (room?.state === 'connected') {
        setHasSeenConnected(true);
      }

      setHostState(
        resolveCanvasRoomHostState(room, {
          allowStandaloneHost: allowStandaloneHost && !hasSeenConnected,
        }),
      );
    };

    recompute();

    if (!room) {
      return;
    }

    const handleParticipantChange = () => recompute();
    room.on('participantConnected', handleParticipantChange);
    room.on('participantDisconnected', handleParticipantChange);
    room.on('connectionStateChanged', handleParticipantChange);

    return () => {
      room.off('participantConnected', handleParticipantChange);
      room.off('participantDisconnected', handleParticipantChange);
      room.off('connectionStateChanged', handleParticipantChange);
    };
  }, [allowStandaloneHost, hasSeenConnected, room]);

  return hostState;
}
