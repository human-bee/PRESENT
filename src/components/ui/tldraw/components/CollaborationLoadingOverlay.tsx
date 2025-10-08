import React from 'react';
import type { CollaborationStatus } from '../hooks/useCollaborationSession';

interface CollaborationLoadingOverlayProps {
  status: CollaborationStatus;
}

function getStatusLabel(status: CollaborationStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting to collaboration room…';
    case 'syncing':
      return 'Syncing latest changes…';
    case 'error':
      return 'Unable to sync canvas. Check logs for details.';
    case 'idle':
      return 'Preparing canvas…';
    default:
      return '';
  }
}

export function CollaborationLoadingOverlay({ status }: CollaborationLoadingOverlayProps) {
  if (status === 'ready') {
    return null;
  }

  const label = getStatusLabel(status);

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-sm text-gray-600"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-md bg-white px-4 py-3 shadow-sm">
        {label || 'Loading canvas…'}
      </div>
    </div>
  );
}

export default CollaborationLoadingOverlay;
