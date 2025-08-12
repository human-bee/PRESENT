import { useEffect, useMemo, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { Room, RoomEvent, Participant } from 'livekit-client'
import { supabase } from '@/lib/supabase'
import { createLiveKitBus } from '@/lib/livekit-bus'

export type CanvasSession = {
  id: string
  canvas_id: string | null
  room_name: string
  participants: any[] | null
  transcript: any[] | null
  canvas_state: any | null
  created_at?: string
  updated_at?: string
}

function getCanvasIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const urlParams = new URLSearchParams(window.location.search)
  return urlParams.get('id')
}

function mapParticipants(room: Room): Array<{ identity: string; name?: string | null; metadata?: string | null }> {
  const list: Array<{ identity: string; name?: string | null; metadata?: string | null }> = []
  // local participant
  if (room.localParticipant) {
    list.push({ identity: room.localParticipant.identity, name: room.localParticipant.name, metadata: room.localParticipant.metadata })
  }
  // remote participants
  room.remoteParticipants.forEach((p) => {
    list.push({ identity: p.identity, name: p.name, metadata: p.metadata })
  })
  return list
}

export function useSessionSync(roomName: string) {
  const room = useRoomContext()
  const bus = useMemo(() => createLiveKitBus(room), [room])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const canvasIdRef = useRef<string | null>(null)
  const transcriptRef = useRef<any[]>([])
  const eventsRef = useRef<any[]>([])

  // Ensure we have or create a session row
  useEffect(() => {
    let isCancelled = false

    async function ensureSession() {
      const canvasId = getCanvasIdFromUrl()
      canvasIdRef.current = canvasId

      // Try to find existing
      let query = supabase
        .from<CanvasSession>('canvas_sessions' as any)
        .select('*')
        .eq('room_name', roomName)
      
      if (canvasId === null) {
        // match rows where canvas_id IS NULL
        // @ts-ignore - supabase-js has .is for null checks
        query = (query as any).is('canvas_id', null)
      } else {
        query = query.eq('canvas_id', canvasId)
      }

      const { data: existing, error: selectErr } = await query
        .limit(1)
        .maybeSingle()

      if (selectErr) {
        console.error('[useSessionSync] Failed to select session', selectErr)
      }

      if (!isCancelled && existing?.id) {
        setSessionId(existing.id)
        transcriptRef.current = Array.isArray(existing.transcript) ? existing.transcript : []
        eventsRef.current = Array.isArray((existing as any).events) ? (existing as any).events : []
        return
      }

      // Create new
      const participants = room ? mapParticipants(room) : []
      const insertPayload = {
        canvas_id: canvasId,
        room_name: roomName,
        participants,
        transcript: [],
        canvas_state: null as any,
        events: [],
      }

      const { data: created, error: insertErr } = await supabase
        .from<CanvasSession>('canvas_sessions' as any)
        .insert(insertPayload as any)
        .select('*')
        .single()

      if (insertErr) {
        console.error('[useSessionSync] Failed to create session', insertErr)
        return
      }

      if (!isCancelled) {
        setSessionId(created.id)
        transcriptRef.current = []
      }
    }

    ensureSession()
    return () => { isCancelled = true }
  }, [roomName, room])

  // Update participants on join/leave
  useEffect(() => {
    if (!room || !sessionId) return

    const updateParticipants = async () => {
      const participants = mapParticipants(room)
      const { error } = await supabase
        .from('canvas_sessions')
        .update({ participants, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
      if (error) console.error('[useSessionSync] Failed to update participants', error)
    }

    const onConnected = () => updateParticipants()
    const onDisconnected = () => updateParticipants()
    const onParticipantConnected = (_p: Participant) => updateParticipants()
    const onParticipantDisconnected = (_p: Participant) => updateParticipants()

    // Initial push
    updateParticipants()

    room.on(RoomEvent.Connected, onConnected)
    room.on(RoomEvent.Disconnected, onDisconnected)
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected)
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)

    return () => {
      room.off(RoomEvent.Connected, onConnected)
      room.off(RoomEvent.Disconnected, onDisconnected)
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected)
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
    }
  }, [room, sessionId])

  // Stream transcription messages to Supabase
  useEffect(() => {
    if (!sessionId) return

    const off = bus.on('transcription', async (msg: any) => {
      if (!msg || typeof msg.text !== 'string') return
      const entry = {
        participantId: msg.participantId ?? msg.speaker ?? 'unknown',
        text: msg.text,
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
      }

      // Append locally and push update
      transcriptRef.current = [...transcriptRef.current, entry]
      const { error } = await supabase
        .from('canvas_sessions')
        .update({ transcript: transcriptRef.current, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
      if (error) console.error('[useSessionSync] Failed to append transcript', error)
    })

    return off
  }, [bus, sessionId])

  // Listen for canvas save events to update session canvas_state
  useEffect(() => {
    if (!sessionId) return

    // Listen for TLDraw snapshots on the LiveKit bus and record as events
    const offTldraw = bus.on('tldraw', async (msg: any) => {
      if (!msg || typeof msg !== 'object') return
      const entry = {
        type: typeof msg.type === 'string' ? msg.type : 'tldraw_event',
        timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
        data: msg.data ?? null,
        source: msg.source ?? 'unknown',
      }
      // Cap events to avoid unbounded growth
      const MAX_EVENTS = 500
      const next = [...eventsRef.current, entry]
      eventsRef.current = next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
      const { error } = await supabase
        .from('canvas_sessions')
        .update({ events: eventsRef.current, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
      if (error) console.error('[useSessionSync] Failed to append tldraw event', error)
    })

    const handler = async (e: Event) => {
      const { snapshot, canvasId } = (e as CustomEvent).detail || {}
      if (!snapshot) return
      // If canvasIdRef is set and a different canvas id comes through, ignore
      if (canvasIdRef.current && canvasId && canvasIdRef.current !== canvasId) return

      const { error } = await supabase
        .from('canvas_sessions')
        .update({ canvas_state: snapshot, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
      if (error) console.error('[useSessionSync] Failed to update canvas_state', error)
    }

    window.addEventListener('tambo:sessionCanvasSaved', handler as EventListener)
    return () => {
      window.removeEventListener('tambo:sessionCanvasSaved', handler as EventListener)
      offTldraw?.()
    }
  }, [sessionId])

  return { sessionId }
}
