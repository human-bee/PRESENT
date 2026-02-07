import { useEffect, useState } from 'react';

const STORAGE_KEY = 'present:fairy-session-state';

export type FairyManualTab = 'introduction' | 'usage' | 'about';

export type LocalSessionState = {
  fairyManualActiveTab: FairyManualTab;
  manualOpened: boolean;
};

const defaultState: LocalSessionState = {
  fairyManualActiveTab: 'introduction',
  manualOpened: false,
};

export function getLocalSessionState(): LocalSessionState {
  if (typeof window === 'undefined') return { ...defaultState };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultState };
    const parsed = JSON.parse(raw) as Partial<LocalSessionState>;
    return { ...defaultState, ...parsed };
  } catch {
    return { ...defaultState };
  }
}

export function updateLocalSessionState(
  updater: (prev: LocalSessionState) => Partial<LocalSessionState>,
): LocalSessionState {
  const current = getLocalSessionState();
  const next = { ...current, ...updater(current) };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }
  return next;
}

export function markManualAsOpened() {
  updateLocalSessionState(() => ({ manualOpened: true }));
}

export function useHasManualBeenOpened() {
  const [opened, setOpened] = useState(() => getLocalSessionState().manualOpened);
  useEffect(() => {
    const handleStorage = () => setOpened(getLocalSessionState().manualOpened);
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
  return opened;
}

export function useAreFairiesDebugEnabled() {
  return false;
}
