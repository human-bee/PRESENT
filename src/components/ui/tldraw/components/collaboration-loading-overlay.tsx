interface CollaborationLoadingOverlayProps {
  isVisible: boolean;
}

export function CollaborationLoadingOverlay({ isVisible }: CollaborationLoadingOverlayProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10 pointer-events-none select-none">
      <div className="text-gray-500">
        Connecting to board… If this hangs, we’ll fall back to live snapshots.
      </div>
    </div>
  );
}
