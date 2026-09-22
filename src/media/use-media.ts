import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { MediaSession } from './media-session';

export type { MediaParticipant, MediaState } from './media-state';

export function useMedia(roomId: string, selfId: string, name: string) {
  const session = useMemo(() => new MediaSession(roomId, selfId, name), [roomId, selfId, name]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => () => session.disconnect(), [session]);
  return { ...state, connect: session.connect, setDevice: session.setDevice, toggleMic: session.toggleMic,
    toggleCamera: session.toggleCamera, toggleScreen: session.toggleScreen, disconnect: session.disconnect };
}

export type Media = ReturnType<typeof useMedia>;
