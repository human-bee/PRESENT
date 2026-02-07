import React, { createContext, useContext, useEffect, useState } from 'react';
import { assertExists } from '@/vendor/tldraw-fairy/compat/tldraw-compat';
import { useAuth } from '@/hooks/use-auth';
import { TldrawApp } from '../app/TldrawApp';

const appContext = createContext<TldrawApp | null>(null);

export function AppStateProvider({
  children,
  fileId,
}: {
  children: React.ReactNode;
  fileId?: string | null;
}) {
  const { user } = useAuth();
  const [app, setApp] = useState<TldrawApp | null>(null);

  const userId = user?.id ?? 'present-dev-user';

  useEffect(() => {
    const nextApp = new TldrawApp(userId);
    setApp(nextApp);
    return () => {
      nextApp.dispose();
    };
  }, [userId]);

  useEffect(() => {
    if (app && fileId) {
      void app.loadFileState(fileId);
    }
  }, [app, fileId]);

  if (!app) return null;

  return <appContext.Provider value={app}>{children}</appContext.Provider>;
}

export function useMaybeApp() {
  return useContext(appContext);
}

export function useApp(): TldrawApp {
  return assertExists(useContext(appContext), 'useApp must be used within AppStateProvider');
}
