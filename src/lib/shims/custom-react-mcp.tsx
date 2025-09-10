import * as React from 'react';

export function customMcpProvider({ children }: { children: React.ReactNode; mcpServers?: any[] }) {
  if (process.env.NODE_ENV === 'development') console.log('[custom shim] customMcpProvider (noop)');
  return <>{children}</>;
}

