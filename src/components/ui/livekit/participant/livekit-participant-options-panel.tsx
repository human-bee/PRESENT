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
  panelRef: React.RefObject<HTMLDivElement | null>;
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
    if (isCoarsePointer) {
      return {
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 1000,
      };
    }
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

  if (!isOpen || typeof document === 'undefined' || (!anchor && !isCoarsePointer)) {
    return null;
  }

  const style = isCoarsePointer ? fallbackStyle : panelStyle ?? fallbackStyle;
  const selectClassName = cn(
    'w-full rounded-lg border border-default bg-surface text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]',
    isCoarsePointer ? 'px-3 py-2.5 text-base' : 'px-2 py-1 text-sm',
  );

  return createPortal(
    <>
      {isCoarsePointer && (
        <button
          type="button"
          aria-label="Close tile options"
          className="fixed inset-0 z-[999] bg-black/35"
          onClick={onClose}
        />
      )}
      <div
        ref={panelRef}
        style={style}
        className={cn(
          'max-h-[70vh] overflow-y-auto border border-default bg-surface-elevated text-primary shadow-sm backdrop-blur-md',
          isCoarsePointer
            ? 'z-[1000] w-auto max-h-[78vh] rounded-2xl p-4 pb-5'
            : 'w-72 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-xl p-3',
        )}
        role="dialog"
        aria-modal={isCoarsePointer ? 'true' : 'false'}
      >
        <div className={cn('mb-3 flex items-center justify-between', isCoarsePointer && 'mb-4')}>
          <div className={cn('font-medium', isCoarsePointer ? 'text-base' : 'text-sm')}>Tile options</div>
          <Button
            aria-label="Close tile options"
            onClick={onClose}
            variant="ghost"
            size="icon"
            className={cn(isCoarsePointer ? 'h-10 w-10' : 'h-8 w-8')}
          >
            ✕
          </Button>
        </div>

        <div className={cn('space-y-3', isCoarsePointer && 'space-y-4')}>
          <div>
            <div className={cn('mb-1 text-secondary', isCoarsePointer ? 'text-sm' : 'text-xs')}>
              Participant
            </div>
            <select
              className={selectClassName}
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
                <div className={cn('text-secondary', isCoarsePointer ? 'text-sm' : 'text-xs')}>Devices</div>
                <Button
                  variant="ghost"
                  size={isCoarsePointer ? 'default' : 'sm'}
                  className={cn(isCoarsePointer && 'h-10 px-3 text-sm')}
                  onClick={onRefreshDevices}
                >
                  Refresh
                </Button>
              </div>
              {isCoarsePointer ? (
                <div className="rounded-lg border border-default bg-surface-secondary p-3 text-sm text-secondary">
                  Device selection is managed by your browser on mobile.
                </div>
              ) : (
                <>
                  <div>
                    <div className="mb-1 text-xs text-secondary">Microphone</div>
                    <select
                      className={selectClassName}
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
                      className={selectClassName}
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
                <div className={cn('mb-1 text-secondary', isCoarsePointer ? 'text-sm' : 'text-xs')}>
                  Stream quality
                </div>
                <div className={cn('flex flex-wrap gap-2', isCoarsePointer && 'gap-2.5')}>
                  {(['auto', 'low', 'high'] as const).map((quality) => (
                    <Button
                      key={quality}
                      variant={selectedQuality === quality ? 'secondary' : 'ghost'}
                      size={isCoarsePointer ? 'default' : 'sm'}
                      className={cn(isCoarsePointer && 'h-10 px-4 text-sm')}
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

        <div
          className={
            isCoarsePointer
              ? 'mt-4 grid grid-cols-1 gap-2'
              : 'mt-4 flex flex-wrap items-center justify-end gap-2'
          }
        >
          <Button
            variant="outline"
            size={isCoarsePointer ? 'default' : 'sm'}
            className={cn(isCoarsePointer && 'h-11 w-full justify-center text-sm')}
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
            size={isCoarsePointer ? 'default' : 'sm'}
            className={cn(isCoarsePointer && 'h-11 w-full justify-center text-sm')}
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
          <Button
            variant="default"
            size={isCoarsePointer ? 'default' : 'sm'}
            className={cn(isCoarsePointer && 'h-11 w-full justify-center text-sm')}
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
