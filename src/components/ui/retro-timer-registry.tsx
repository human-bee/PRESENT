/**
 * Registry-enabled RetroTimer
 *
 * This wraps the existing RetroTimer with the new ComponentRegistry system
 * to enable AI updates without changing the original component code.
 */

'use client';

import React from 'react';
import { RetroTimer, retroTimerSchema, type RetroTimerProps } from './retro-timer';
import { withTamboRegistry, type TamboRegistryProps } from '@/lib/tambo-registry-wrapper';

// Custom update handler for RetroTimer
function handleRetroTimerUpdate(
  props: RetroTimerProps,
  patch: Record<string, unknown>,
): Partial<RetroTimerProps> {
  const updates: Partial<RetroTimerProps> = {};

  // Handle timer duration updates
  if ('initialMinutes' in patch && typeof patch.initialMinutes === 'number') {
    updates.initialMinutes = patch.initialMinutes;
  }

  if ('initialSeconds' in patch && typeof patch.initialSeconds === 'number') {
    updates.initialSeconds = patch.initialSeconds;
  }

  // Handle title updates
  if ('title' in patch && typeof patch.title === 'string') {
    updates.title = patch.title;
  }

  // Handle preset visibility
  if ('showPresets' in patch && typeof patch.showPresets === 'boolean') {
    updates.showPresets = patch.showPresets;
  }

  // Handle sound URL updates
  if ('soundUrl' in patch && typeof patch.soundUrl === 'string') {
    updates.soundUrl = patch.soundUrl;
  }

  return updates;
}

// Create the registry-enabled component
export const RetroTimerRegistry = withTamboRegistry(
  RetroTimer,
  'RetroTimer',
  handleRetroTimerUpdate,
);

// Re-export the schema and types for convenience
export { retroTimerSchema, type RetroTimerProps };
