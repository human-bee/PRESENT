import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { Room, RoomEvent, Participant } from 'livekit-client';
import { supabase } from '@/lib/supabase';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';
import {
  buildSyncContract,
  getCanvasIdFromCurrentUrl,
  validateSessionPair,
} from '@/lib/realtime/sync-contract';

export type CanvasSession = {
  id: string;
  canvas_id: string | null;
  room_name: string;
  participants: any[] | null;
  transcript: any[] | null;
  canvas_state: any | null;
  created_at?: string;
  updated_at?: string;
};

function isValidUuid(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getCanvasIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const urlParams = new URLSearchParams(window.location.search);
  const raw = urlParams.get('id');
  return isValidUuid(raw) ? raw : null;
}

function mapParticipants(
  room: Room,
): Array<{ identity: string; name?: string | null; metadata?: string | null }> {
  const list: Array<{
    identity: string;
    name?: string | null;
    metadata?: string | null;
  }> = [];
  // local participant
  if (room.localParticipant) {
    list.push({
      identity: room.localParticipant.identity,
      name: room.localParticipant.name,
      metadata: room.localParticipant.metadata,
    });
  }
  // remote participants
  room.remoteParticipants.forEach((p) => {
    list.push({ identity: p.identity, name: p.name, metadata: p.metadata });
  });
  return list;
}

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

export function useSessionSync(roomName: string) {
  const room = useRoomContext();
  const bus = useMemo(() => createLiveKitBus(room), [room]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const canvasIdRef = useRef<string | null>(null);
  const cancelledRef = useRef<boolean>(false);
  const isWriterRef = useRef<boolean>(false);
  const [isWriter, setIsWriter] = useState<boolean>(false);

  type TranscriptEntry = {
    eventId: string;
    participantId: string;
    participantName?: string | null;
    text: string;
    timestamp: number;
    manual: boolean;
  };

  const pendingTranscriptRef = useRef<TranscriptEntry[]>([]);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushInFlightRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TRANSCRIPT_FLUSH_DEBOUNCE_MS = 900;

  const enqueueTranscript = (entry: TranscriptEntry) => {
    if (!entry.text || !entry.eventId) return;
    const seen = seenEventIdsRef.current;
    if (seen.has(entry.eventId)) return;
    seen.add(entry.eventId);
    if (seen.size > 2000) {
      // Simple guard against unbounded memory growth.
      const first = seen.values().next().value;
      if (first) seen.delete(first);
    }
    pendingTranscriptRef.current.push(entry);
  };

  const flushTranscriptBatch = useMemo(() => {
    return async (sid: string) => {
      if (!isWriterRef.current) return;
      if (flushInFlightRef.current) return;
      if (pendingTranscriptRef.current.length === 0) return;

      flushInFlightRef.current = true;
      try {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        while (pendingTranscriptRef.current.length > 0) {
          const batch = pendingTranscriptRef.current.slice(0, 25);
          const headers = await getAuthHeaders();
          const res = await fetch('/api/session-transcripts', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              sessionId: sid,
              entries: batch.map((line) => ({
                eventId: line.eventId,
                participantId: line.participantId,
                participantName: line.participantName ?? null,
                text: line.text,
                timestamp: line.timestamp,
                manual: line.manual,
              })),
            }),
          });
          if (!res.ok) {
            const bodyText = await res.text().catch(() => '');
            console.error('[useSessionSync] Failed to persist transcript batch', bodyText);
            // If unauthenticated, don't keep retrying forever (production was spamming 500s via RLS failures).
            if (res.status === 401 || res.status === 403) {
              pendingTranscriptRef.current = [];
              break;
            }
            break;
          }
          pendingTranscriptRef.current = pendingTranscriptRef.current.slice(batch.length);
        }
      } finally {
        flushInFlightRef.current = false;
        // If we still have entries pending (e.g. auth not ready / transient network), retry shortly.
        if (pendingTranscriptRef.current.length > 0 && isWriterRef.current && !retryTimeoutRef.current) {
          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            void flushTranscriptBatch(sid);
          }, 1500);
        }
      }
    };
  }, []);

  const scheduleTranscriptFlush = useMemo(() => {
    return (sid: string) => {
      if (!isWriterRef.current) return;
      if (flushTimeoutRef.current) return;
      flushTimeoutRef.current = setTimeout(async () => {
        flushTimeoutRef.current = null;
        await flushTranscriptBatch(sid);
      }, TRANSCRIPT_FLUSH_DEBOUNCE_MS);
    };
  }, [flushTranscriptBatch]);

  const ensureSession = useMemo(() => {
    const fetchSession = async (canvasId: string | null) => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ roomName });
      if (canvasId !== null) params.set('canvasId', canvasId);
      else params.set('canvasId', 'null');

      const res = await fetch(`/api/session?${params.toString()}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) {
        console.error('[useSessionSync] Failed to fetch session', await res.text());
        return null;
      }
      const json = await res.json();
      return json.session;
    };

    const createSession = async (payload: any) => {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/session', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        return { error: json, code: json.code };
      }
      return { data: json.session };
    };

    return async function ensureSession() {
      const initialCanvasId = getCanvasIdFromUrl();
      canvasIdRef.current = initialCanvasId;
      const reportSessionPair = (session: { room_name?: string | null; canvas_id?: string | null } | null) => {
        if (typeof window === 'undefined' || !session) return;
        try {
          const contract = buildSyncContract({
            roomName,
            canvasId: initialCanvasId ?? getCanvasIdFromCurrentUrl(),
            tldrawRoomId: roomName,
          });
          const errors = validateSessionPair(contract, {
            roomName: session.room_name,
            canvasId: session.canvas_id,
          });
          const diagnostics = {
            ok: errors.length === 0,
            sessionId: (session as any)?.id ?? null,
            roomName: session.room_name ?? null,
            canvasId: session.canvas_id ?? null,
            errors,
            updatedAt: Date.now(),
          };
          const w = window as any;
          w.__present = w.__present || {};
          w.__present.syncDiagnostics = w.__present.syncDiagnostics || {};
          w.__present.syncDiagnostics.session = diagnostics;
          window.dispatchEvent(
            new CustomEvent('present:sync-diagnostic', {
              detail: { source: 'session', ...diagnostics },
            }),
          );
        } catch {
          // noop
        }
      };

      const existing = await fetchSession(initialCanvasId);
      reportSessionPair(existing);

      if (!cancelledRef.current && existing?.id) {
        setSessionId(existing.id);
        return;
      }

      // Create new
      const participants = room ? mapParticipants(room) : [];
      const insertPayload = {
        canvas_id: initialCanvasId,
        room_name: roomName,
        participants,
        transcript: [],
        canvas_state: null as any,
      };

      const { data: created, error: insertErr, code } = await createSession(insertPayload);

      if (insertErr) {
        const messageString = typeof insertErr.error === 'string' ? insertErr.error.toLowerCase() : '';
        const isDuplicate = code === '23505' || messageString.includes('duplicate key');

        if (isDuplicate) {
          const existingAfterConflict = await fetchSession(initialCanvasId);
          reportSessionPair(existingAfterConflict);
          if (existingAfterConflict?.id) {
            if (!cancelledRef.current) {
              setSessionId(existingAfterConflict.id);
            }
            return;
          }
        }

        const isMissingCanvas = code === '23503' || messageString.includes('not present in table "canvases"');
        if (isMissingCanvas) {
          const fallbackPayload = { ...insertPayload, canvas_id: null };
          const { data: fallback, error: fallbackErr } = await createSession(fallbackPayload);
          if (!fallbackErr && fallback?.id && !cancelledRef.current) {
            setSessionId(fallback.id);
            return;
          }
          if (fallbackErr) {
            console.warn('[useSessionSync] Fallback session insert failed', fallbackErr);
          }
        }

        console.error('[useSessionSync] Failed to create session', insertErr);
        return;
      }

      if (!cancelledRef.current && created) {
        reportSessionPair(created);
        setSessionId(created.id);
      }
    };
  }, [roomName, room]);

  // Ensure we have or create a session row
  useEffect(() => {
    cancelledRef.current = false;
    ensureSession();
    return () => {
      cancelledRef.current = true;
    };
  }, [ensureSession]);

  // If canvas id in URL changes (e.g., due to thread switch), re-run ensureSession
  useEffect(() => {
    const rerun = () => {
      ensureSession();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('present:canvas-id-changed', rerun);
      return () => window.removeEventListener('present:canvas-id-changed', rerun);
    }
  }, [ensureSession]);

  // Determine a single "writer" per room to avoid duplicated transcript inserts.
  useEffect(() => {
    if (!room) {
      setIsWriter(false);
      isWriterRef.current = false;
      return;
    }

    const isAgentParticipant = (p: any) => {
      try {
        const kind = String(p?.kind ?? '').toLowerCase();
        if (kind === 'agent') return true;
        const identity = String(p?.identity || '').toLowerCase();
        const metadata = String(p?.metadata || '').toLowerCase();
        return (
          identity.startsWith('agent-') ||
          identity.includes('voice-agent') ||
          metadata.includes('voice-agent') ||
          metadata.includes('agent')
        );
      } catch {
        return false;
      }
    };

    const recompute = () => {
      const localId = room.localParticipant?.identity || '';
      if (!localId || isAgentParticipant(room.localParticipant)) {
        setIsWriter(false);
        isWriterRef.current = false;
        return;
      }

      const ids = [localId];
      room.remoteParticipants.forEach((p) => {
        if (isAgentParticipant(p)) return;
        if (p?.identity) ids.push(p.identity);
      });
      ids.sort();
      const nextIsWriter = ids[0] === localId;
      setIsWriter(nextIsWriter);
      isWriterRef.current = nextIsWriter;
    };

    recompute();
    const handleChange = () => recompute();
    room.on(RoomEvent.ParticipantConnected, handleChange);
    room.on(RoomEvent.ParticipantDisconnected, handleChange);
    room.on(RoomEvent.Connected, handleChange);
    room.on(RoomEvent.Disconnected, handleChange);
    return () => {
      room.off(RoomEvent.ParticipantConnected, handleChange);
      room.off(RoomEvent.ParticipantDisconnected, handleChange);
      room.off(RoomEvent.Connected, handleChange);
      room.off(RoomEvent.Disconnected, handleChange);
    };
  }, [room]);

  // Update participants on join/leave
  useEffect(() => {
    if (!room || !sessionId) return;

    const updateParticipants = async () => {
      const participants = mapParticipants(room);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ participants, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) console.error('[useSessionSync] Failed to update participants', await res.text());
    };

    const onConnected = () => updateParticipants();
    const onDisconnected = () => updateParticipants();
    const onParticipantConnected = (_p: Participant) => updateParticipants();
    const onParticipantDisconnected = (_p: Participant) => updateParticipants();

    // Initial push
    updateParticipants();

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);
    };
  }, [room, sessionId]);

  // Persist transcripts via append-only table (one writer per room).
  useEffect(() => {
    if (!sessionId) return;

    const off = bus.on('transcription', async (msg: any) => {
      if (!msg || typeof msg.text !== 'string') return;
      if (msg.replay) return;
      const isFinal =
        typeof msg.is_final === 'boolean'
          ? msg.is_final
          : typeof msg.isFinal === 'boolean'
            ? msg.isFinal
            : typeof msg.final === 'boolean'
              ? msg.final
              : true;
      // Only persist final transcripts to avoid ballooning the transcript table with interim updates.
      if (!isFinal) return;
      if (!isWriterRef.current) return;
      const eventId =
        typeof msg.event_id === 'string'
          ? msg.event_id
          : typeof msg.eventId === 'string'
            ? msg.eventId
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const entry: TranscriptEntry = {
        eventId,
        participantId: String(msg.participantId ?? msg.speaker ?? 'unknown'),
        participantName:
          typeof msg.participantName === 'string'
            ? msg.participantName
            : typeof msg.speaker === 'string'
              ? msg.speaker
              : null,
        text: msg.text,
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        manual: Boolean(msg.manual),
      };

      enqueueTranscript(entry);
      scheduleTranscriptFlush(sessionId);
    });

    return off;
  }, [bus, sessionId, scheduleTranscriptFlush]);

  // Handle manual local transcripts (sender may not receive their own data packets).
  useEffect(() => {
    if (!sessionId) return;

    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (!detail || typeof detail.text !== 'string') return;
      if (detail.replay) return;
      if (!isWriterRef.current) return;
      const eventId =
        typeof detail.event_id === 'string'
          ? detail.event_id
          : typeof detail.eventId === 'string'
            ? detail.eventId
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      enqueueTranscript({
        eventId,
        participantId: String(detail.participantId ?? detail.speaker ?? 'unknown'),
        participantName:
          typeof detail.participantName === 'string'
            ? detail.participantName
            : typeof detail.speaker === 'string'
              ? detail.speaker
              : null,
        text: String(detail.text),
        timestamp: typeof detail.timestamp === 'number' ? detail.timestamp : Date.now(),
        manual: Boolean(detail.manual),
      });
      scheduleTranscriptFlush(sessionId);
    };

    window.addEventListener('custom:transcription-local', handler as EventListener);
    return () => {
      window.removeEventListener('custom:transcription-local', handler as EventListener);
    };
  }, [sessionId, scheduleTranscriptFlush]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const w = window as any;
      w.__present = w.__present || {};
      w.__present.sessionSync = {
        sessionId,
        roomName,
        isWriter,
        updatedAt: Date.now(),
      };
      window.dispatchEvent(
        new CustomEvent('present:session-sync', {
          detail: w.__present.sessionSync,
        }),
      );
    } catch {
      // noop
    }
  }, [isWriter, roomName, sessionId]);

  return { sessionId };
}
