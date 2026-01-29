'use client';

import { useEffect, useRef } from 'react';
import type { Participant, Room } from 'livekit-client';
import { RoomEvent } from 'livekit-client';

type ActiveSpeakerSnapshot = {
  participantId: string;
  name?: string;
  audioLevel?: number;
  timestamp: number;
  roomName?: string;
  source: 'active-speakers';
};

const ACTIVE_SPEAKER_KEY = '__presentActiveSpeaker';
const ACTIVE_SPEAKER_MAP_KEY = '__presentActiveSpeakerByRoom';
const MIN_SWITCH_MS = 350;

const isAgentParticipant = (participant: Participant | undefined) => {
  if (!participant) return false;
  const flagged = Boolean((participant as any)?.isAgent || (participant as any)?.permissions?.agent);
  if (flagged) return true;
  const identity = String(participant.identity || participant.name || '').toLowerCase();
  if (!identity) return false;
  if (identity.startsWith('agent-')) return true;
  if (identity.includes('voice-agent')) return true;
  return identity.includes('agent');
};

const pickBestSpeaker = (participants: Participant[]) => {
  if (!participants.length) return null;
  const eligible = participants.filter((p) => !isAgentParticipant(p));
  const pool = eligible.length ? eligible : participants;
  const ranked = [...pool].sort((a, b) => {
    const aLevel = Number.isFinite((a as any).audioLevel) ? (a as any).audioLevel : 0;
    const bLevel = Number.isFinite((b as any).audioLevel) ? (b as any).audioLevel : 0;
    return bLevel - aLevel;
  });
  return ranked[0] ?? null;
};

export function useActiveSpeakerTracker(room?: Room) {
  const lastSpeakerRef = useRef<ActiveSpeakerSnapshot | null>(null);
  const lastDispatchRef = useRef(0);

  useEffect(() => {
    if (!room) return;

    const roomName = room.name || '';

    const publish = (participant: Participant | null) => {
      if (!participant) return;
      const participantId = participant.identity || participant.sid || '';
      if (!participantId) return;

      const now = Date.now();
      const previous = lastSpeakerRef.current;
      if (previous?.participantId === participantId && now - lastDispatchRef.current < MIN_SWITCH_MS) {
        return;
      }
      if (previous?.participantId && previous.participantId !== participantId) {
        if (now - lastDispatchRef.current < MIN_SWITCH_MS) {
          return;
        }
      }

      const snapshot: ActiveSpeakerSnapshot = {
        participantId,
        name: participant.name || undefined,
        audioLevel: Number.isFinite((participant as any).audioLevel) ? (participant as any).audioLevel : undefined,
        timestamp: now,
        roomName: roomName || undefined,
        source: 'active-speakers',
      };

      lastSpeakerRef.current = snapshot;
      lastDispatchRef.current = now;

      if (typeof window !== 'undefined') {
        (window as any)[ACTIVE_SPEAKER_KEY] = snapshot;
        if (roomName) {
          const map = ((window as any)[ACTIVE_SPEAKER_MAP_KEY] || {}) as Record<string, ActiveSpeakerSnapshot>;
          map[roomName] = snapshot;
          (window as any)[ACTIVE_SPEAKER_MAP_KEY] = map;
        }
        try {
          window.dispatchEvent(new CustomEvent('present:active-speaker-changed', { detail: snapshot }));
        } catch {
          // ignore dispatch errors
        }
      }
    };

    const clearRoomSnapshot = () => {
      if (typeof window === 'undefined' || !roomName) return;
      const map = ((window as any)[ACTIVE_SPEAKER_MAP_KEY] || {}) as Record<
        string,
        ActiveSpeakerSnapshot
      >;
      if (map[roomName]) {
        delete map[roomName];
        (window as any)[ACTIVE_SPEAKER_MAP_KEY] = map;
      }
      const global = (window as any)[ACTIVE_SPEAKER_KEY] as ActiveSpeakerSnapshot | undefined;
      if (global?.roomName === roomName) {
        delete (window as any)[ACTIVE_SPEAKER_KEY];
      }
    };

    const handleActiveSpeakers = (speakers: Participant[]) => {
      const best = pickBestSpeaker(speakers || []);
      if (best) publish(best);
    };

    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
    room.on(RoomEvent.Disconnected, clearRoomSnapshot);
    const initialSpeakers = (room as any).activeSpeakers;
    if (Array.isArray(initialSpeakers)) {
      handleActiveSpeakers(initialSpeakers as Participant[]);
    }

    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
      room.off(RoomEvent.Disconnected, clearRoomSnapshot);
      clearRoomSnapshot();
    };
  }, [room]);
}
