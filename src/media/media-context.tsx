import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Media } from './use-media';

export type CanvasMediaSource = Pick<Media, 'status' | 'participants'> & Partial<Pick<Media, 'mic' | 'camera' | 'toggleMic' | 'toggleCamera' | 'setDevice'>>;
const CanvasMediaContext = createContext<CanvasMediaSource | null>(null);

export function CanvasMediaProvider({ media, children }: { media: CanvasMediaSource; children: ReactNode }) {
  const value = useMemo(() => media, [media]);
  return <CanvasMediaContext.Provider value={value}>{children}</CanvasMediaContext.Provider>;
}

export function useCanvasMedia(): CanvasMediaSource | null { return useContext(CanvasMediaContext); }
