import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type TranscriptLine = {
  eventId?: string;
  participantId: string;
  participantName?: string | null;
  text: string;
  timestamp: number;
  manual?: boolean;
};

function isValidUuid(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getCanvasIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('id');
  return isValidUuid(raw) ? raw : null;
}

export function useRealtimeSessionTranscript(roomName: string | undefined) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);

  // Locate session row id and hydrate
  useEffect(() => {
    if (!roomName) return;
    let cancelled = false;

    async function getAuthHeaders(): Promise<Record<string, string>> {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      return headers;
    }

    async function fetchTranscriptLines(targetSessionId: string) {
      try {
        const headers = await getAuthHeaders();
        const params = new URLSearchParams({
          sessionId: targetSessionId,
          limit: '200',
        });
        const res = await fetch(`/api/session-transcripts?${params.toString()}`, { headers });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const rows = Array.isArray(json?.transcript) ? json.transcript : [];
        const lines: TranscriptLine[] = rows
          .map((t: any) => ({
            eventId: typeof t.eventId === 'string' ? t.eventId : undefined,
            participantId: String(t.participantId ?? 'unknown'),
            participantName:
              typeof t.participantName === 'string' && t.participantName.trim().length > 0
                ? t.participantName.trim()
                : null,
            text: String(t.text ?? ''),
            timestamp: typeof t.timestamp === 'number' ? t.timestamp : Date.now(),
            manual: typeof t.manual === 'boolean' ? t.manual : undefined,
          }))
          .filter((line) => line.text.trim().length > 0);
        if (!cancelled) {
          setTranscript(lines);
        }
      } catch {
        // ignore fetch failures; live data-channel updates will still show new lines
      }
    }

    async function init() {
      const canvasId = getCanvasIdFromUrl();

      let query = supabase
        .from('canvas_sessions' as any)
        .select('id')
        .eq('room_name', roomName);
      query =
        canvasId === null ? (query as any).is('canvas_id', null) : query.eq('canvas_id', canvasId);

      const { data, error } = await query.limit(1).maybeSingle();
      if (error) return;
      if (cancelled) return;
      if (data?.id) {
        setSessionId(data.id);
        await fetchTranscriptLines(String(data.id));
      }
    }

    init();
    // Also listen to canvas id changes from UI
    const onCanvasIdChanged = () => init();
    if (typeof window !== 'undefined') {
      window.addEventListener('present:canvas-id-changed', onCanvasIdChanged);
    }
    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('present:canvas-id-changed', onCanvasIdChanged);
      }
    };
  }, [roomName]);

  return { sessionId, transcript };
}
