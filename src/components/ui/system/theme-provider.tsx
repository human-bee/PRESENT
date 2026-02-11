'use client';

import * as React from 'react';

export type PresentThemeMode = 'light' | 'dark' | 'system';
export type PresentResolvedTheme = 'light' | 'dark';

type ThemeContextValue = {
  mode: PresentThemeMode;
  resolved: PresentResolvedTheme;
  setMode: (mode: PresentThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'present:theme';

function resolveTheme(mode: PresentThemeMode): PresentResolvedTheme {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function applyThemeToDom(mode: PresentThemeMode) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(mode);
  const root = document.documentElement;

  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');

  // Apps SDK UI dark mode is keyed off `data-theme="dark"`.
  root.dataset.theme = resolved;
  root.dataset.presentTheme = mode;
}

export function PresentThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<PresentThemeMode>(() => {
    if (typeof window === 'undefined') return 'system';
    try {
      const stored = (window.localStorage.getItem(STORAGE_KEY) || 'system') as PresentThemeMode;
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
      return 'system';
    } catch {
      return 'system';
    }
  });

  const resolved = React.useMemo(() => (typeof window === 'undefined' ? 'light' : resolveTheme(mode)), [mode]);

  const setMode = React.useCallback((next: PresentThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    applyThemeToDom(next);
  }, []);

  const toggle = React.useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  // Keep DOM in sync after hydration.
  React.useEffect(() => {
    applyThemeToDom(mode);
  }, [mode]);

  // React to system theme changes only when in `system`.
  React.useEffect(() => {
    if (mode !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeToDom('system');
    try {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } catch {
      // Safari fallback
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
  }, [mode]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function usePresentTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error('usePresentTheme must be used within PresentThemeProvider');
  }
  return ctx;
}
