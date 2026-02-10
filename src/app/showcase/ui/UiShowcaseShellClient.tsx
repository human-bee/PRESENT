'use client';

import * as React from 'react';
import { UiShowcaseClient } from './UiShowcaseClient';

export function UiShowcaseShellClient() {
  // Avoid SSR/CSR hydration mismatches in this dev-only route by rendering nothing until mounted.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <UiShowcaseClient />;
}

