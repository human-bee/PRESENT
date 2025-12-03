import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { Room, RoomEvent, Participant } from 'livekit-client';
import { supabase } from '@/lib/supabase';
import { createLiveKitBus } from '@/lib/livekit/livekit-bus';

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
  const transcriptRef = useRef<any[]>([]);
  const eventsRef = useRef<any[]>([]);
  const hasReplayedTranscriptRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);
  const lastCanvasPatchRef = useRef<number>(0);
  const throttleMs = 2500; // avoid hammering session API with large snapshots

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

      const existing = await fetchSession(initialCanvasId);

      if (!cancelledRef.current && existing?.id) {
        setSessionId(existing.id);
        transcriptRef.current = Array.isArray(existing.transcript) ? existing.transcript : [];
        eventsRef.current = Array.isArray((existing as any).events) ? (existing as any).events : [];
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
        events: [],
      };

      const { data: created, error: insertErr, code } = await createSession(insertPayload);

      if (insertErr) {
        const messageString = typeof insertErr.error === 'string' ? insertErr.error.toLowerCase() : '';
        const isDuplicate = code === '23505' || messageString.includes('duplicate key');
        
        if (isDuplicate) {
          const existingAfterConflict = await fetchSession(initialCanvasId);
          if (existingAfterConflict?.id) {
            if (!cancelledRef.current) {
              setSessionId(existingAfterConflict.id);
              transcriptRef.current = Array.isArray(existingAfterConflict.transcript)
                ? existingAfterConflict.transcript
                : [];
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
            transcriptRef.current = [];
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
        setSessionId(created.id);
        transcriptRef.current = [];
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
      hasReplayedTranscriptRef.current = false;
      ensureSession();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('present:canvas-id-changed', rerun);
      return () => window.removeEventListener('present:canvas-id-changed', rerun);
    }
  }, [ensureSession]);

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

  // Stream transcription messages to Supabase
  useEffect(() => {
    if (!sessionId) return;

    const off = bus.on('transcription', async (msg: any) => {
      if (!msg || typeof msg.text !== 'string') return;
      const entry = {
        participantId: msg.participantId ?? msg.speaker ?? 'unknown',
        text: msg.text,
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
      };

      // Append locally and push update
      transcriptRef.current = [...transcriptRef.current, entry];
      
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          transcript: transcriptRef.current,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) console.error('[useSessionSync] Failed to append transcript', await res.text());
    });

    return off;
  }, [bus, sessionId]);

  // On reload, replay the last N transcript lines after the room connects
  // Uses batched processing to avoid blocking the main thread
  useEffect(() => {
    if (!sessionId || !room) return;

    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 16; // ~1 frame

    const replayBatch = (lines: typeof transcriptRef.current, startIndex: number) => {
      const endIndex = Math.min(startIndex + BATCH_SIZE, lines.length);
      
      for (let i = startIndex; i < endIndex; i++) {
        const line = lines[i];
        try {
          // Send to LiveKit for other participants (batched)
          bus.send('transcription', {
            type: 'live_transcription',
            speaker: line.participantId ?? 'unknown',
            text: line.text ?? '',
            timestamp: typeof line.timestamp === 'number' ? line.timestamp : Date.now(),
            is_final: true,
            replay: true,
          });
          // Dispatch for local hydration (TranscriptProvider handles this)
          try {
            window.dispatchEvent(
              new CustomEvent('livekit:transcription-replay', {
                detail: {
                  speaker: line.participantId ?? 'unknown',
                  text: line.text ?? '',
                  timestamp: typeof line.timestamp === 'number' ? line.timestamp : Date.now(),
                },
              }),
            );
          } catch { }
        } catch {
          // ignore
        }
      }
      
      // Schedule next batch if there are more lines
      if (endIndex < lines.length) {
        setTimeout(() => replayBatch(lines, endIndex), BATCH_DELAY_MS);
      }
    };

    const replay = () => {
      if (hasReplayedTranscriptRef.current) return;
      if (!Array.isArray(transcriptRef.current) || transcriptRef.current.length === 0) return;
      if (room.state !== 'connected') return;

      hasReplayedTranscriptRef.current = true;
      const MAX_REPLAY = 100;
      const recent = transcriptRef.current.slice(-MAX_REPLAY);
      
      // Start batched replay
      replayBatch(recent, 0);
    };

    if (room.state === 'connected') replay();
    room.on(RoomEvent.Connected, replay);
    return () => {
      room.off(RoomEvent.Connected, replay);
    };
  }, [bus, sessionId, room]);

  // Handle manual local transcripts
  useEffect(() => {
    if (!sessionId) return;

    const handler = async (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (!detail || typeof detail.text !== 'string') return;
      if (detail.replay) return;
      const entry = {
        participantId: detail.participantId ?? detail.speaker ?? 'unknown',
        text: String(detail.text),
        timestamp: typeof detail.timestamp === 'number' ? detail.timestamp : Date.now(),
      };
      transcriptRef.current = [...transcriptRef.current, entry];
      
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          transcript: transcriptRef.current,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) console.error('[useSessionSync] Failed to append local transcript', await res.text());
    };

    window.addEventListener('custom:transcription-local', handler as EventListener);
    return () => {
      window.removeEventListener('custom:transcription-local', handler as EventListener);
    };
  }, [sessionId]);

  // Listen for canvas save events to update session canvas_state
  useEffect(() => {
    if (!sessionId) return;
    // Listen for TLDraw snapshots on the LiveKit bus and record as events
    const offTldraw = bus.on('tldraw', async (msg: any) => {
      if (!msg || typeof msg !== 'object') return;
      const entry = {
        type: typeof msg.type === 'string' ? msg.type : 'tldraw_event',
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        data: msg.data ?? null,
        source: msg.source ?? 'unknown',
      };
      // Cap events to avoid unbounded growth
      const MAX_EVENTS = 500;
      const next = [...eventsRef.current, entry];
      eventsRef.current = next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          events: eventsRef.current,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) console.error('[useSessionSync] Failed to append tldraw event', await res.text());
    });

    const handler = async (e: Event) => {
      const { snapshot, canvasId } = (e as CustomEvent).detail || {};
      if (!snapshot) return;
      if (canvasIdRef.current && canvasId && canvasIdRef.current !== canvasId) return;

       // Throttle large canvas_state writes to reduce backend timeouts
      const now = Date.now();
      if (now - lastCanvasPatchRef.current < throttleMs) {
        return;
      }
      lastCanvasPatchRef.current = now;

      const headers = await getAuthHeaders();
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          canvas_state: snapshot,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) console.error('[useSessionSync] Failed to update canvas_state', await res.text());
    };

    window.addEventListener('custom:sessionCanvasSaved', handler as EventListener);
    return () => {
      window.removeEventListener('custom:sessionCanvasSaved', handler as EventListener);
      offTldraw?.();
    };
  }, [sessionId]);

  return { sessionId };
}
