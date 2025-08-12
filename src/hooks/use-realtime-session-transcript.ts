import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type TranscriptLine = {
  participantId: string
  text: string
  timestamp: number
}

function getCanvasIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('id')
}

export function useRealtimeSessionTranscript(roomName: string | undefined) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Locate session row id and hydrate
  useEffect(() => {
    if (!roomName) return
    let cancelled = false

    async function init() {
      const canvasId = getCanvasIdFromUrl()

      let query = supabase.from('canvas_sessions').select('id, transcript').eq('room_name', roomName)
      // @ts-expect-error supabase .is exists for null checks
      query = canvasId === null ? (query as any).is('canvas_id', null) : query.eq('canvas_id', canvasId)

      const { data, error } = await query.limit(1).maybeSingle()
      if (error) return
      if (cancelled) return
      if (data?.id) {
        setSessionId(data.id)
        if (Array.isArray(data.transcript)) {
          // Validate shape defensively
          const lines: TranscriptLine[] = data.transcript.map((t: any) => ({
            participantId: String(t.participantId ?? 'unknown'),
            text: String(t.text ?? ''),
            timestamp: typeof t.timestamp === 'number' ? t.timestamp : Date.now(),
          }))
          setTranscript(lines)
        }

        // Subscribe to realtime updates for this row
        if (channelRef.current) {
          try { channelRef.current.unsubscribe() } catch {}
          channelRef.current = null
        }
        const ch = supabase.channel(`canvas_sessions_${data.id}`)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'canvas_sessions', filter: `id=eq.${data.id}` }, (payload) => {
            const next = (payload.new as any)?.transcript
            if (Array.isArray(next)) {
              const lines: TranscriptLine[] = next.map((t: any) => ({
                participantId: String(t.participantId ?? 'unknown'),
                text: String(t.text ?? ''),
                timestamp: typeof t.timestamp === 'number' ? t.timestamp : Date.now(),
              }))
              setTranscript(lines)
            }
          })
          .subscribe()
        channelRef.current = ch
      }
    }

    init()
    return () => {
      cancelled = true
      if (channelRef.current) {
        try { channelRef.current.unsubscribe() } catch {}
        channelRef.current = null
      }
    }
  }, [roomName])

  return { sessionId, transcript }
}
