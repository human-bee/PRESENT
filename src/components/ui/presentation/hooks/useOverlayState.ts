import { useCallback, useEffect, useState } from 'react';

type OverlayState = {
  notesOpen: boolean;
  thumbnailsOpen: boolean;
  isFullscreen: boolean;
};

type OverlayOptions = {
  storageKey?: string;
  defaultNotes?: boolean;
  defaultThumbnails?: boolean;
  defaultFullscreen?: boolean;
};

const DEFAULT_STORAGE_KEY = 'presentation:overlay-state';

function createInitialState(options: OverlayOptions): OverlayState {
  return {
    notesOpen: options.defaultNotes ?? false,
    thumbnailsOpen: options.defaultThumbnails ?? false,
    isFullscreen: options.defaultFullscreen ?? false,
  };
}

export function useOverlayState(options: OverlayOptions = {}) {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const [state, setState] = useState<OverlayState>(() => createInitialState(options));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<OverlayState>;
        setState((prev) => ({
          notesOpen: parsed.notesOpen ?? prev.notesOpen,
          thumbnailsOpen: parsed.thumbnailsOpen ?? prev.thumbnailsOpen,
          isFullscreen: parsed.isFullscreen ?? prev.isFullscreen,
        }));
      }
    } catch {
      // ignore storage errors
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // ignore persistence failures
    }
  }, [storageKey, state]);

  const toggleNotes = useCallback(() => {
    setState((prev) => ({ ...prev, notesOpen: !prev.notesOpen }));
  }, []);

  const toggleThumbnails = useCallback(() => {
    setState((prev) => ({ ...prev, thumbnailsOpen: !prev.thumbnailsOpen }));
  }, []);

  const setFullscreen = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, isFullscreen: value }));
  }, []);

  return {
    notesOpen: state.notesOpen,
    thumbnailsOpen: state.thumbnailsOpen,
    isFullscreen: state.isFullscreen,
    toggleNotes,
    toggleThumbnails,
    setFullscreen,
  };
}
