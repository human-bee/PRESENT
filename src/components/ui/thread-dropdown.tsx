/**
 * Minimal ThreadDropdown to satisfy imports. Emits onThreadChange when user selects a thread.
 */

'use client';

import * as React from 'react';

export function ThreadDropdown({
  contextKey,
  onThreadChange,
}: {
  contextKey?: string;
  onThreadChange?: (newThreadId?: string) => void;
}) {
  // For now, render nothing; a full implementation can list threads and call onThreadChange.
  return null;
}

