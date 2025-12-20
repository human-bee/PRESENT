'use client';

import { useCallback, useMemo } from 'react';
import '@/vendor/tldraw-fairy/tla/styles/fairy.css';
import type { Room } from 'livekit-client';
import { AppStateProvider } from '@/vendor/tldraw-fairy/tla/hooks/useAppState';
import { FairyAppProvider } from '@/vendor/tldraw-fairy/fairy/fairy-app/FairyAppProvider';
import { Fairies } from '@/vendor/tldraw-fairy/fairy/fairy-canvas-ui/Fairies';
import { FairyHUD } from '@/vendor/tldraw-fairy/fairy/fairy-ui/FairyHUD';
import { FairyPromptPanel } from './fairy-prompt-panel';
import { FairyLiveKitBridge } from './fairy-livekit-bridge';
import type { FairyApp } from '@/vendor/tldraw-fairy/fairy/fairy-app/FairyApp';

function getCanvasIdFromLocation(): string {
  if (typeof window === 'undefined') return 'local';
  try {
    const url = new URL(window.location.href);
    const id = url.searchParams.get('id');
    if (id && id.length > 0) return id;
    const room = url.searchParams.get('room');
    if (room && room.startsWith('canvas-')) {
      return room.replace('canvas-', '');
    }
  } catch {}
  return 'local';
}

export function FairyIntegration({ room }: { room?: Room }) {
  const fileId = useMemo(() => getCanvasIdFromLocation(), []);
  const showDevPanel =
    typeof process !== 'undefined' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.NEXT_PUBLIC_FAIRY_DEV_PANEL === 'true';

  const handleMount = useCallback((fairyApp: FairyApp) => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    w.__presentFairyApp = fairyApp;
  }, []);

  const handleUnmount = useCallback(() => {
    if (typeof window === 'undefined') return;
    const w = window as any;
    delete w.__presentFairyApp;
  }, []);

  return (
    <AppStateProvider fileId={fileId}>
      <FairyAppProvider fileId={fileId} onMount={handleMount} onUnmount={handleUnmount}>
        <FairyLiveKitBridge room={room} />
        <Fairies />
        <FairyHUD />
        {showDevPanel && <FairyPromptPanel />}
      </FairyAppProvider>
    </AppStateProvider>
  );
}
