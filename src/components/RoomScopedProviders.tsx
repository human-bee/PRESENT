'use client';
import { createContext, ReactNode, useContext } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { TranscriptProvider } from '@/lib/stores/transcript-store';
import { useActiveSpeakerTracker } from '@/components/ui/livekit/hooks/useActiveSpeakerTracker';
import { ContextProvider } from '@/lib/stores/context-store';

const ContextKeyContext = createContext<string | undefined>(undefined);
export const useContextKey = () => useContext(ContextKeyContext);

export function RoomScopedProviders({ children }: { children: ReactNode }) {
  const room = useRoomContext();
  const key = room?.name || 'canvas';
  useActiveSpeakerTracker(room ?? undefined);
  return (
    <ContextKeyContext.Provider value={key}>
      <ContextProvider sessionId={key}>
        <TranscriptProvider>{children}</TranscriptProvider>
      </ContextProvider>
    </ContextKeyContext.Provider>
  );
}
