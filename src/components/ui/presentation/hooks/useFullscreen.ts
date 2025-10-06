import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';

type UseFullscreenOptions = {
  targetRef: RefObject<Element | null>;
  onChange?: (value: boolean) => void;
};

export function useFullscreen({ targetRef, onChange }: UseFullscreenOptions) {
  const notify = useCallback(
    (value: boolean) => {
      onChange?.(value);
    },
    [onChange],
  );

  const enterFullscreen = useCallback(async () => {
    const target = targetRef.current ?? document.documentElement;
    try {
      await target.requestFullscreen();
      notify(true);
    } catch {
      // ignore
    }
  }, [targetRef, notify]);

  const exitFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) {
      notify(false);
      return;
    }

    try {
      await document.exitFullscreen();
    } catch {
      // ignore
    } finally {
      notify(false);
    }
  }, [notify]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen]);

  useEffect(() => {
    const handleChange = () => {
      notify(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, [notify]);

  return {
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  };
}
