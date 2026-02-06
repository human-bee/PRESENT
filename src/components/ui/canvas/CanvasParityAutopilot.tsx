'use client';

import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLivekitConnection } from '@/components/ui/livekit/hooks';
import { useCanvasLiveKit } from '@/components/ui/livekit/livekit-room-connector';
import { createLogger } from '@/lib/utils';
import { getBooleanFlag } from '@/lib/feature-flags';

const logger = createLogger('CanvasParityAutopilot');

export function CanvasParityAutopilot() {
  const searchParams = useSearchParams();
  const livekitState = useCanvasLiveKit();
  const parityRequested = searchParams?.get('parity') === '1';
  const roomOverride = searchParams?.get('room')?.trim() ?? '';
  const envAutoConnect = getBooleanFlag(process.env.NEXT_PUBLIC_LIVEKIT_AUTO_CONNECT, false);
  const demoMode = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);

  const resolvedRoomName = useMemo(() => {
    if (roomOverride) {
      return roomOverride;
    }
    if (livekitState?.roomName) {
      return livekitState.roomName;
    }
    return '';
  }, [roomOverride, livekitState?.roomName]);

  const autopilotEnabled = (parityRequested || envAutoConnect || demoMode) && resolvedRoomName.length > 0;

  const resolvedUserName = useMemo(() => {
    if (typeof window === 'undefined') return 'Canvas User';
    try {
      const stored = window.localStorage.getItem('present:display_name')?.trim() || '';
      return stored || 'Canvas User';
    } catch {
      return 'Canvas User';
    }
  }, []);

  const { state, connect, disconnect } = useLivekitConnection({
    roomName: resolvedRoomName || 'canvas-room',
    userName: resolvedUserName,
    audioOnly: demoMode,
    autoConnect: false,
  });

  useEffect(() => {
    if (!autopilotEnabled) {
      return;
    }
    if (state.connectionState === 'disconnected' || state.connectionState === 'error') {
      logger.info('[CanvasParityAutopilot] auto-connecting to room', resolvedRoomName);
      void connect();
    }
  }, [autopilotEnabled, state.connectionState, connect, resolvedRoomName]);

  useEffect(() => {
    if (!autopilotEnabled) {
      void disconnect();
      return;
    }
    if (state.connectionState === 'connected') {
      logger.info('[CanvasParityAutopilot] connected to room', resolvedRoomName);
    }
  }, [autopilotEnabled, disconnect, state.connectionState, resolvedRoomName]);

  return null;
}
