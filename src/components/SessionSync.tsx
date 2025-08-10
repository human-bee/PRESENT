"use client";

import React from 'react'
import { useSessionSync } from '@/hooks/use-session-sync'

export function SessionSync({ roomName }: { roomName: string }) {
  useSessionSync(roomName)
  return null
}

export default SessionSync