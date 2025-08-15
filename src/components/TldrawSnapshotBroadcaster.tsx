"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from 'tldraw'
import { useRoomContext } from '@livekit/components-react'
import { createLiveKitBus } from '@/lib/livekit-bus'

type Props = { editor?: Editor | null }

export function TldrawSnapshotBroadcaster({ editor: propEditor }: Props) {
  const room = useRoomContext()
  const bus = useMemo(() => createLiveKitBus(room), [room])
  const lastSentRef = useRef(0)
  const [editor, setEditor] = useState<Editor | null>(propEditor ?? null)

  // Capture editor from global hook or event if not provided via props
  useEffect(() => {
    if (propEditor && editor !== propEditor) {
      setEditor(propEditor)
      return
    }

    if (editor) return

    // Try global assignment performed on mount
    try {
      const maybe = (window as any).__present?.tldrawEditor as Editor | undefined
      if (maybe) setEditor(maybe)
    } catch {}

    // Listen for explicit editor-mounted event
    const handler = (e: Event) => {
      const ed = (e as CustomEvent).detail?.editor as Editor | undefined
      if (ed) setEditor(ed)
    }
    window.addEventListener('present:editor-mounted', handler as EventListener)
    return () => window.removeEventListener('present:editor-mounted', handler as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propEditor])

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
