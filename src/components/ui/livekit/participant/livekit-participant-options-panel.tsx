import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

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
        'w-72 max-w-[min(20rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-zinc-900/95 p-3 text-white shadow-xl backdrop-blur-md',
      )}
      role="dialog"
      aria-modal="false"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium">Tile Options</div>
        <button
          aria-label="Close tile options"
          onClick={onClose}
          className="rounded-full px-2 py-1 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 text-xs text-white/70">Participant</div>
          <select
            className="w-full rounded bg-white/10 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
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
              <div className="text-xs text-white/70">Devices</div>
              <button
                className="rounded px-2 py-1 text-xs transition hover:bg-white/20 bg-white/10"
                onClick={onRefreshDevices}
              >
                Refresh
              </button>
            </div>
            {isCoarsePointer ? (
              <div className="rounded bg-white/5 p-2 text-xs text-white/60">
                Device selection is managed by your browser on mobile.
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-1 text-xs text-white/70">Microphone</div>
                  <select
                    className="w-full rounded bg-white/10 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
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
                  <div className="mb-1 text-xs text-white/70">Camera</div>
                  <select
                    className="w-full rounded bg-white/10 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
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
              <div className="mb-1 text-xs text-white/70">Stream Quality</div>
              <div className="flex gap-2">
                {(['auto', 'low', 'high'] as const).map((quality) => (
                  <button
                    key={quality}
                    className={cn(
                      'rounded px-2 py-1 text-xs transition-colors',
                      selectedQuality === quality
                        ? 'bg-white/20 text-white'
                        : 'bg-white/10 text-white hover:bg-white/20',
                    )}
                    onClick={() => {
                      onSelectQuality(quality);
                    }}
                  >
                    {quality}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          className="rounded bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
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
        </button>
        <button
          className="rounded bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20"
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
        </button>
        <button
          className="rounded bg-white/20 px-3 py-1.5 text-sm transition hover:bg-white/30"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
