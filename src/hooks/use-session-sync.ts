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
  // Simple UUID v4-ish check (accepts any UUID variant)
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

export function useSessionSync(roomName: string) {
  const room = useRoomContext();
  const bus = useMemo(() => createLiveKitBus(room), [room]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const canvasIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<any[]>([]);
  const eventsRef = useRef<any[]>([]);
  const hasReplayedTranscriptRef = useRef<boolean>(false);
  const cancelledRef = useRef<boolean>(false);

  const ensureSession = useMemo(() => {
    const buildQuery = (canvasId: string | null) => {
      let base = supabase.from('canvas_sessions' as any).select('*').eq('room_name', roomName);
      return canvasId === null ? (base as any).is('canvas_id', null) : base.eq('canvas_id', canvasId);
    };

    return async function ensureSession() {
      const initialCanvasId = getCanvasIdFromUrl();
      canvasIdRef.current = initialCanvasId;

      let query = buildQuery(initialCanvasId);

      const { data: existing, error: selectErr } = await query.limit(1).maybeSingle();

      if (selectErr) {
        console.error('[useSessionSync] Failed to select session', selectErr);
      }

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

      // Use upsert to avoid conflict on unique (room_name, canvas_id)
      const attemptInsert = async (payload: typeof insertPayload) => {
        return await supabase.from('canvas_sessions' as any).insert(payload as any).select('*').single();
      };

      const { data: created, error: insertErr } = await attemptInsert(insertPayload);

      if (insertErr) {
        const code = (insertErr as { code?: string })?.code;
        const messageString = typeof insertErr.message === 'string' ? insertErr.message.toLowerCase() : '';
        const isDuplicate = code === '23505' || messageString.includes('duplicate key');
        if (isDuplicate) {
          const { data: existingAfterConflict } = await query.limit(1).maybeSingle();
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
          query = buildQuery(null);
          const { data: fallback, error: fallbackErr } = await attemptInsert(fallbackPayload);
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
      const { error } = await supabase
        .from('canvas_sessions')
        .update({ participants, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
      if (error) console.error('[useSessionSync] Failed to update participants', error);
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
      const { error } = await supabase
        .from('canvas_sessions')
        .update({
          transcript: transcriptRef.current,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
      if (error) console.error('[useSessionSync] Failed to append transcript', error);
    });

    return off;
  }, [bus, sessionId]);

  // On reload, replay the last N transcript lines after the room connects so any
  // listeners (e.g. captions widgets) can rehydrate their local view.
  useEffect(() => {
    if (!sessionId || !room) return;

    const replay = () => {
      if (hasReplayedTranscriptRef.current) return;
      if (!Array.isArray(transcriptRef.current) || transcriptRef.current.length === 0) return;
      if (room.state !== 'connected') return;

      hasReplayedTranscriptRef.current = true;
      const MAX_REPLAY = 100;
      const recent = transcriptRef.current.slice(-MAX_REPLAY);
      for (const line of recent) {
        try {
          bus.send('transcription', {
            type: 'live_transcription',
            speaker: line.participantId ?? 'unknown',
            text: line.text ?? '',
            timestamp: typeof line.timestamp === 'number' ? line.timestamp : Date.now(),
            is_final: true,
            replay: true,
          });
          // Also notify local UI (LiveCaptions doesn't receive local data channel loopback)
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
    };

    // Try immediately if already connected; otherwise on connect
    if (room.state === 'connected') replay();
    room.on(RoomEvent.Connected, replay);
    return () => {
      room.off(RoomEvent.Connected, replay);
    };
  }, [bus, sessionId, room]);

  // Handle manual local transcripts that never loop back over the LiveKit data channel
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
      const { error } = await supabase
        .from('canvas_sessions')
        .update({
          transcript: transcriptRef.current,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
      if (error) console.error('[useSessionSync] Failed to append local transcript', error);
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
      const { error } = await supabase
        .from('canvas_sessions')
        .update({
          events: eventsRef.current,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
      if (error) console.error('[useSessionSync] Failed to append tldraw event', error);
    });

    const handler = async (e: Event) => {
      const { snapshot, canvasId } = (e as CustomEvent).detail || {};
      if (!snapshot) return;
      // If canvasIdRef is set and a different canvas id comes through, ignore
      if (canvasIdRef.current && canvasId && canvasIdRef.current !== canvasId) return;

      const { error } = await supabase
        .from('canvas_sessions')
        .update({
          canvas_state: snapshot,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
      if (error) console.error('[useSessionSync] Failed to update canvas_state', error);
    };

    window.addEventListener('custom:sessionCanvasSaved', handler as EventListener);
    return () => {
      window.removeEventListener('custom:sessionCanvasSaved', handler as EventListener);
      offTldraw?.();
    };
  }, [sessionId]);

  return { sessionId };
}
