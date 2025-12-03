'use client';
import { createContext, ReactNode, useContext } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { TranscriptProvider } from '@/lib/stores/transcript-store';

const ContextKeyContext = createContext<string | undefined>(undefined);
export const useContextKey = () => useContext(ContextKeyContext);

export function RoomScopedProviders({ children }: { children: ReactNode }) {
  const room = useRoomContext();
  const key = room?.name || 'canvas';
  return (
    <ContextKeyContext.Provider value={key}>
      <TranscriptProvider>{children}</TranscriptProvider>
    </ContextKeyContext.Provider>
  );
}
