import { useCallback, useEffect, useRef } from 'react';

type DeckHotkeyHandlers = {
  next: () => void;
  prev: () => void;
  togglePlay: () => void;
  toggleNotes: () => void;
  toggleThumbnails: () => void;
  toggleFullscreen: () => void;
  toggleLaserPointer?: () => void;
  toggleBookmark?: () => void;
  reset?: () => void;
  goToFirst?: () => void;
  goToLast?: () => void;
};

function shouldPreventDefault(key: string) {
  return ['ArrowRight', 'ArrowLeft', ' ', 'Space', 'Enter'].includes(key);
}

export function useDeckHotkeys(enabled: boolean, handlers: DeckHotkeyHandlers) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) {
        return;
      }

      const key = event.key;
      const currentHandlers = handlersRef.current;

      if (shouldPreventDefault(key)) {
        event.preventDefault();
      }

      switch (key) {
        case 'ArrowRight':
        case ' ':
        case 'Space':
        case 'n':
        case 'j':
          currentHandlers.next();
          break;
        case 'ArrowLeft':
        case 'p':
        case 'k':
          currentHandlers.prev();
          break;
        case 'Enter':
          currentHandlers.togglePlay();
          break;
        case 'f':
        case 'F11':
          currentHandlers.toggleFullscreen();
          break;
        case 't':
          currentHandlers.toggleThumbnails();
          break;
        case 's':
          currentHandlers.toggleNotes();
          break;
        case 'l':
          currentHandlers.toggleLaserPointer?.();
          break;
        case 'b':
          currentHandlers.toggleBookmark?.();
          break;
        case 'r':
          currentHandlers.reset?.();
          break;
        case 'Home':
          currentHandlers.goToFirst?.();
          break;
        case 'End':
          currentHandlers.goToLast?.();
          break;
        case 'Escape':
          if (document.fullscreenElement) {
            currentHandlers.toggleFullscreen();
          }
          break;
        default:
          break;
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);
}
