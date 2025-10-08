import { useCallback, useEffect, useRef } from 'react';
import { STORAGE_KEY_PREFIX } from '../utils';

function createSlug(source: string): string {
  return source.replace(/\s+/g, '-').slice(0, 24) || 'user';
}

export function useLkIdentity(displayName: string, roomName: string): () => string {
  const identityRef = useRef<string | null>(null);
  const storageKey = `${STORAGE_KEY_PREFIX}${roomName}`;

  const ensureIdentity = useCallback(() => {
    if (identityRef.current) {
      return identityRef.current;
    }

    const base = createSlug(displayName || 'user');
    const generated = `${base}-${Math.random().toString(36).slice(2, 8)}`;
    identityRef.current = generated;

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(storageKey, generated);
      } catch {
        // ignore storage failures
      }
    }

    return generated;
  }, [displayName, storageKey]);

  useEffect(() => {
    identityRef.current = null;

    if (typeof window === 'undefined') {
      ensureIdentity();
      return;
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        identityRef.current = stored;
        return;
      }
    } catch {
      // ignore storage access errors
    }

    ensureIdentity();
  }, [ensureIdentity, storageKey]);

  return ensureIdentity;
}
