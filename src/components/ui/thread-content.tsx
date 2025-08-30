/**
 * Minimal ThreadContent components to unblock the UI.
 */

'use client';

import * as React from 'react';

export function ThreadContent({ children, variant }: { children?: React.ReactNode; variant?: string }) {
  return <div data-thread-content-variant={variant}>{children}</div>;
}

export function ThreadContentMessages() {
  // Placeholder – real implementation would render thread messages.
  return null;
}

