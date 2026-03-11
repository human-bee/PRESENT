'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLivekitConnection } from '@/components/ui/livekit/hooks';
import { useCanvasLiveKit } from '@/components/ui/livekit/livekit-room-connector';
import { createLogger } from '@/lib/utils';
import { getBooleanFlag } from '@/lib/feature-flags';

const logger = createLogger('CanvasParityAutopilot');
const INITIAL_RECONNECT_BACKOFF_MS = 1_000;
const MAX_RECONNECT_BACKOFF_MS = 30_000;

export function CanvasParityAutopilot() {
  const searchParams = useSearchParams();
  const livekitState = useCanvasLiveKit();
  const parityRequested = searchParams?.get('parity') === '1';
  const roomOverride = searchParams?.get('room')?.trim() ?? '';
  const envAutoConnect = getBooleanFlag(process.env.NEXT_PUBLIC_LIVEKIT_AUTO_CONNECT, false);
  const demoMode = getBooleanFlag(process.env.NEXT_PUBLIC_CANVAS_DEMO_MODE, false);
  const reconnectBackoffRef = useRef(INITIAL_RECONNECT_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedRoomName = useMemo(() => {
    if (roomOverride) {
      return roomOverride;
    }
    if (livekitState?.roomName) {
      return livekitState.roomName;
    }
    return '';
  }, [roomOverride, livekitState?.roomName]);

  // Keep demo sessions opt-in for LiveKit to avoid unexpected background reconnect/media churn.
  const autopilotEnabled = (parityRequested || envAutoConnect) && resolvedRoomName.length > 0;

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
    publishLocalMedia: false,
    autoRequestAgent: false,
  });

  useEffect(() => {
    if (!autopilotEnabled) {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectBackoffRef.current = INITIAL_RECONNECT_BACKOFF_MS;
      void disconnect();
    }
  }, [autopilotEnabled, disconnect]);

  useEffect(() => {
    if (!autopilotEnabled) {
      return;
    }

    if (state.connectionState === 'connected') {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectBackoffRef.current = INITIAL_RECONNECT_BACKOFF_MS;
      logger.info('[CanvasParityAutopilot] connected to room', resolvedRoomName);
      return;
    }

    if (
      state.connectionState === 'connecting' ||
      state.connectionState === 'reconnecting' ||
      reconnectTimerRef.current
    ) {
      return;
    }

    const delayMs = reconnectBackoffRef.current;
    reconnectBackoffRef.current = Math.min(reconnectBackoffRef.current * 2, MAX_RECONNECT_BACKOFF_MS);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      logger.info('[CanvasParityAutopilot] auto-connecting to room', `${resolvedRoomName} (delay ${delayMs}ms)`);
      void connect();
    }, delayMs);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [autopilotEnabled, connect, resolvedRoomName, state.connectionState]);

  return null;
}
