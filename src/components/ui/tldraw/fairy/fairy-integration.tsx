'use client';

import type { Room } from 'livekit-client';
import { getBooleanFlag } from '@/lib/feature-flags';
import { FairyPromptPanel } from './fairy-prompt-panel';

export function FairyIntegration({ room }: { room?: Room }) {
  // Room is intentionally unused in server-first fairy mode.
  void room;

  if (process.env.NODE_ENV === 'production') return null;
  const showDevPanel = getBooleanFlag(process.env.NEXT_PUBLIC_FAIRY_DEV_PANEL, false);
  if (!showDevPanel) return null;

  return <FairyPromptPanel />;
}
