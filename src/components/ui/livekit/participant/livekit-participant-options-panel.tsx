import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shared/button';

type AnchorRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

type ParticipantSummary = {
  id: string;
  name: string;
};

type ParticipantTileOptionsPanelProps = {
  isOpen: boolean;
  anchor: AnchorRect | null;
  panelRef: React.RefObject<HTMLDivElement>;
  panelStyle: React.CSSProperties | null;
  isCoarsePointer: boolean;
  onClose: () => void;
  onRefreshDevices: () => void;
  participantId: string;
  allParticipants: ParticipantSummary[];
  onSelectParticipant?: (id: string) => void;
  isLocal: boolean;
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
  microphoneSelectValue: string;
  cameraSelectValue: string;
  onSelectMicrophone: (deviceId: string) => Promise<void>;
  onSelectCamera: (deviceId: string) => Promise<void>;
  selectedQuality: 'auto' | 'low' | 'high';
  onSelectQuality: (quality: 'auto' | 'low' | 'high') => void;
};

export function ParticipantTileOptionsPanel({
  isOpen,
  anchor,
  panelRef,
  panelStyle,
  isCoarsePointer,
  onClose,
  onRefreshDevices,
  participantId,
  allParticipants,
  onSelectParticipant,
  isLocal,
  audioDevices,
  videoDevices,
  microphoneSelectValue,
  cameraSelectValue,
  onSelectMicrophone,
  onSelectCamera,
  selectedQuality,
  onSelectQuality,
}: ParticipantTileOptionsPanelProps) {
  const fallbackStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!anchor) return undefined;
    const verticalGap = isCoarsePointer ? 20 : 16;
    return {
      position: 'fixed',
      top: anchor.bottom + verticalGap,
      left: anchor.right,
      transform: 'translateX(-100%)',
      zIndex: 1000,
    };
  }, [anchor, isCoarsePointer]);

  if (!isOpen || !anchor || typeof document === 'undefined') {
    return null;
  }

  const style = panelStyle ?? fallbackStyle;

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className={cn(
        'w-72 max-w-[min(20rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto rounded-xl border border-default bg-surface-elevated p-3 text-primary shadow-sm backdrop-blur-md',
      )}
      role="dialog"
      aria-modal="false"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium">Tile options</div>
        <Button
          aria-label="Close tile options"
          onClick={onClose}
          variant="ghost"
          size="icon"
          className="h-8 w-8"
        >
          ✕
        </Button>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 text-xs text-secondary">Participant</div>
          <select
            className="w-full rounded-lg border border-default bg-surface px-2 py-1 text-sm text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
            value={participantId}
            onChange={(event) => {
              try {
                onSelectParticipant?.(event.target.value);
              } catch {}
            }}
          >
            {allParticipants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {isLocal && (
          <>
            <div className="flex items-center justify-between">
              <div className="text-xs text-secondary">Devices</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefreshDevices}
              >
                Refresh
              </Button>
            </div>
            {isCoarsePointer ? (
              <div className="rounded-lg border border-default bg-surface-secondary p-2 text-xs text-secondary">
                Device selection is managed by your browser on mobile.
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-1 text-xs text-secondary">Microphone</div>
                  <select
                    className="w-full rounded-lg border border-default bg-surface px-2 py-1 text-sm text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                    value={microphoneSelectValue}
                    onChange={async (event) => {
                      await onSelectMicrophone(event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      {audioDevices.length ? 'Select a microphone' : 'No microphones found'}
                    </option>
                    {audioDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || 'Microphone'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs text-secondary">Camera</div>
                  <select
                    className="w-full rounded-lg border border-default bg-surface px-2 py-1 text-sm text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]"
                    value={cameraSelectValue}
                    onChange={async (event) => {
                      await onSelectCamera(event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      {videoDevices.length ? 'Select a camera' : 'No cameras found'}
                    </option>
                    {videoDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || 'Camera'}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div>
              <div className="mb-1 text-xs text-secondary">Stream quality</div>
              <div className="flex gap-2">
                {(['auto', 'low', 'high'] as const).map((quality) => (
                  <Button
                    key={quality}
                    variant={selectedQuality === quality ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => {
                      onSelectQuality(quality);
                    }}
                  >
                    {quality}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('tldraw:pin', {
                detail: { participantId },
              }),
            );
            onClose();
          }}
        >
          Pin
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('tldraw:pinOnTop', {
                detail: { participantId },
              }),
            );
            onClose();
          }}
        >
          Pin on top
        </Button>
        <Button variant="default" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>,
    document.body,
  );
}
