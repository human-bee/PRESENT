import * as React from 'react';
import { cn } from '@/lib/utils';
import { Mic, MicOff, MoreHorizontal, ScreenShare, Video, VideoOff } from 'lucide-react';

export type ParticipantToolbarProps = {
  visible: boolean;
  overlayVisible: boolean;
  isCoarsePointer: boolean;
  isMinimized: boolean;
  isLocal: boolean;
  effectiveAudioMuted: boolean;
  videoMuted: boolean;
  screenSharing: boolean;
  onToggleLocalMic: () => Promise<void> | void;
  onToggleLocalCamera: () => Promise<void> | void;
  onToggleRemoteAudio: () => void;
  onToggleScreenShare: () => Promise<void> | Promise<boolean> | boolean;
  openOptions: () => void;
  optionsButtonRef: (node: HTMLButtonElement | null) => void;
};

export function ParticipantToolbar({
  visible,
  overlayVisible,
  isCoarsePointer,
  isMinimized,
  isLocal,
  effectiveAudioMuted,
  videoMuted,
  screenSharing,
  onToggleLocalMic,
  onToggleLocalCamera,
  onToggleRemoteAudio,
  onToggleScreenShare,
  openOptions,
  optionsButtonRef,
}: ParticipantToolbarProps) {
  if (!visible) return null;

  const buttonSizeClass = isCoarsePointer ? 'h-12 w-12 rounded-lg' : 'h-11 w-11 rounded-md';
  const iconSizeClass = isCoarsePointer ? 'h-5 w-5' : 'h-4 w-4';
  const toolbarChromeClass = isCoarsePointer
    ? 'rounded-2xl bg-black/65 px-2 py-2'
    : 'rounded-lg bg-black/55 p-1.5';

  const renderButtons = () => (
    <div
      className={cn(
        toolbarChromeClass,
        'flex max-w-full items-center justify-center gap-1.5 shadow-lg backdrop-blur-md',
      )}
    >
      <button
        aria-label={
          effectiveAudioMuted
            ? isLocal
              ? 'Unmute microphone'
              : 'Unmute participant audio'
            : isLocal
              ? 'Mute microphone'
              : 'Mute participant audio'
        }
        aria-keyshortcuts={isLocal ? 'M' : undefined}
        onClick={async () => {
          if (isLocal) {
            await onToggleLocalMic();
            return;
          }
          onToggleRemoteAudio();
        }}
        className={cn(
          buttonSizeClass,
          'touch-manipulation grid place-items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]',
          effectiveAudioMuted
            ? 'bg-danger-solid text-white hover:opacity-90'
            : 'bg-white/10 text-white hover:bg-white/20',
        )}
      >
        {effectiveAudioMuted ? (
          <MicOff className={iconSizeClass} />
        ) : (
          <Mic className={iconSizeClass} />
        )}
      </button>

      <button
        aria-label={videoMuted ? 'Turn camera on' : 'Turn camera off'}
        aria-keyshortcuts="V"
        onClick={async () => {
          await onToggleLocalCamera();
        }}
        className={cn(
          buttonSizeClass,
          'touch-manipulation grid place-items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]',
          videoMuted ? 'bg-danger-solid text-white hover:opacity-90' : 'bg-white/10 text-white hover:bg-white/20',
        )}
      >
        {videoMuted ? <VideoOff className={iconSizeClass} /> : <Video className={iconSizeClass} />}
      </button>

      {isLocal && (
        <button
          aria-label={screenSharing ? 'Stop screen share' : 'Start screen share'}
          onClick={async () => {
            await onToggleScreenShare();
          }}
          className={cn(
            buttonSizeClass,
            'touch-manipulation grid place-items-center bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]',
          )}
        >
          <ScreenShare className={iconSizeClass} />
        </button>
      )}

      <button
        aria-label="Tile options"
        onClick={openOptions}
        ref={optionsButtonRef}
        className={cn(
          buttonSizeClass,
          'touch-manipulation grid place-items-center bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--present-accent-ring)]',
        )}
      >
        <MoreHorizontal className={iconSizeClass} />
      </button>
    </div>
  );

  return (
    <>
      <div
        className={cn(
          'absolute inset-0 pointer-events-none select-none',
          overlayVisible ? 'opacity-100' : 'opacity-0',
          'transition-opacity duration-200',
        )}
        aria-hidden={!overlayVisible}
      >
        <div
          className={cn(
            'absolute pointer-events-auto',
            isCoarsePointer
              ? isMinimized
                ? 'bottom-1 left-2 right-2 flex justify-center'
                : 'bottom-2 left-2 right-2 flex justify-center'
              : 'bottom-2 right-2',
          )}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          {renderButtons()}
        </div>
      </div>
    </>
  );
}
