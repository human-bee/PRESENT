"use client";
import { createContext, ReactNode, useContext } from 'react';
import { useRoomContext } from '@livekit/components-react';

const ContextKeyContext = createContext<string | undefined>(undefined);
export const useContextKey = () => useContext(ContextKeyContext);

export function RoomScopedProviders({ children }: { children: ReactNode }) {
  const room = useRoomContext();
  const key = room?.name || 'canvas';
  return (
    <ContextKeyContext.Provider value={key}>{children}</ContextKeyContext.Provider>
  );
} 