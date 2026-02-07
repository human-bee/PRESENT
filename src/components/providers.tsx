'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { AppsSDKUIProvider } from '@openai/apps-sdk-ui/components/AppsSDKUIProvider';
import { PresentThemeProvider } from '@/components/ui/system/theme-provider';

declare global {
  // Enables typed defaults for Apps SDK UI link components.
  // See: https://github.com/openai/apps-sdk-ui#configure-router-optional
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AppsSDKUIConfig {
    LinkComponent: typeof Link;
  }
}

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            console.error('Query error:', error);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PresentThemeProvider>
        <AppsSDKUIProvider linkComponent={Link}>{children}</AppsSDKUIProvider>
      </PresentThemeProvider>
    </QueryClientProvider>
  );
}
