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

  const renderButtons = () => (
    <div className="bg-black/55 backdrop-blur-md rounded-lg p-1.5 flex items-center gap-1 shadow-lg">
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
          'w-11 h-11 rounded-md grid place-items-center transition-colors',
          effectiveAudioMuted
            ? 'bg-red-500/80 text-white hover:bg-red-600/80'
            : 'bg-white/10 text-white hover:bg-white/20',
        )}
      >
        {effectiveAudioMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
      </button>

      <button
        aria-label={videoMuted ? 'Turn camera on' : 'Turn camera off'}
        aria-keyshortcuts="V"
        onClick={async () => {
          await onToggleLocalCamera();
        }}
        className={cn(
          'w-11 h-11 rounded-md grid place-items-center transition-colors',
          videoMuted ? 'bg-red-500/80 text-white hover:bg-red-600/80' : 'bg-white/10 text-white hover:bg-white/20',
        )}
      >
        {videoMuted ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
      </button>

      {isLocal && (
        <button
          aria-label={screenSharing ? 'Stop screen share' : 'Start screen share'}
          onClick={async () => {
            await onToggleScreenShare();
          }}
          className="w-11 h-11 rounded-md grid place-items-center bg-white/10 text-white hover:bg-white/20 transition-colors"
        >
          <ScreenShare className="w-4 h-4" />
        </button>
      )}

      <button
        aria-label="Tile options"
        onClick={openOptions}
        ref={optionsButtonRef}
        className="w-11 h-11 rounded-md grid place-items-center bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
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
          className="absolute bottom-2 right-2 pointer-events-auto"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          {renderButtons()}
        </div>
      </div>

      {isCoarsePointer && !isMinimized && (
        <div className="absolute bottom-2 right-2 pointer-events-auto">
          <button
            aria-label="Tile options"
            onClick={openOptions}
            ref={optionsButtonRef}
            className="w-11 h-11 rounded-full bg-black/55 text-white backdrop-blur-md grid place-items-center shadow-lg"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      )}
    </>
  );
}
