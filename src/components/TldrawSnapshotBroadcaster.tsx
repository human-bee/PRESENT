"use client";

import React, { useEffect, useMemo, useRef } from 'react'
import { useEditor } from 'tldraw'
import { useRoomContext } from '@livekit/components-react'
import { createLiveKitBus } from '@/lib/livekit-bus'

export function TldrawSnapshotBroadcaster() {
  const editor = useEditor()
  const room = useRoomContext()
  const bus = useMemo(() => createLiveKitBus(room), [room])
  const lastSentRef = useRef(0)

  useEffect(() => {
    if (!editor) return

    const unsubscribe = editor.store.listen(() => {
      const now = Date.now()
      if (now - lastSentRef.current < 1500) return
      lastSentRef.current = now
      try {
        const snapshot = editor.getSnapshot()
        bus.send('tldraw', {
          type: 'tldraw_snapshot',
          data: snapshot,
          timestamp: now,
          source: 'client'
        })
        // Also push to Supabase via the session event so persistence stays authoritative
        try {
          window.dispatchEvent(new CustomEvent('tambo:sessionCanvasSaved', { detail: { snapshot } }))
        } catch {}
      } catch {
        // ignore
      }
    }, { scope: 'document' })

    return () => unsubscribe()
  }, [editor, bus])

  return null
}

export default TldrawSnapshotBroadcaster
