'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { z } from 'zod';
import {
  useParticipants,
  useLocalParticipant,
  useTracks,
  VideoTrack,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { ScreenShare, X } from 'lucide-react';

export const livekitScreenShareTileSchema = z.object({
  participantIdentity: z
    .string()
    .optional()
    .describe('Participant identity to display screen share for; defaults to local if available'),
  width: z.number().optional().describe('Width of the tile in pixels (default 640)'),
  height: z.number().optional().describe('Height of the tile in pixels (default 360)'),
  borderRadius: z.number().optional().describe('Border radius in pixels (default 12)'),
  showParticipantName: z.boolean().optional().describe('Show participant name (default true)'),
  fit: z.enum(['contain', 'cover']).optional().describe('object-fit policy (default contain)'),
});

export type LivekitScreenShareTileProps = z.infer<typeof livekitScreenShareTileSchema>;

type ScreenShareTileState = {
  isMinimized: boolean;
};

export function LivekitScreenShareTile({
  participantIdentity,
  width = 640,
  height = 360,
  borderRadius = 12,
  showParticipantName = true,
  fit = 'contain',
}: LivekitScreenShareTileProps) {
  const [state, setState] = React.useState<ScreenShareTileState>({ isMinimized: false });

  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  const targetParticipant = React.useMemo(() => {
    if (participantIdentity) {
      if (localParticipant?.identity === participantIdentity) return localParticipant;
      return participants.find((p) => p.identity === participantIdentity) || null;
    }
    return localParticipant || participants[0] || null;
  }, [participantIdentity, localParticipant, participants]);

  const trackRefs = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  const screenTrackRef = React.useMemo(
    () =>
      trackRefs.find(
        (t) =>
          t.participant?.identity === targetParticipant?.identity &&
          t.source === Track.Source.ScreenShare,
      ),
    [trackRefs, targetParticipant?.identity],
  );

  const screenPub = screenTrackRef?.publication;
  const isLocal = targetParticipant === localParticipant;

  // Hover overlay timers
  const [overlayVisible, setOverlayVisible] = React.useState(false);
  const showTimer = React.useRef<number | null>(null);
  const hideTimer = React.useRef<number | null>(null);

  const onEnter = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    showTimer.current = window.setTimeout(() => setOverlayVisible(true), 600);
  };
  const onLeave = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => setOverlayVisible(false), 1500);
  };
  React.useEffect(
    () => () => {
      if (showTimer.current) window.clearTimeout(showTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const stopShare = async () => {
    try {
      // Prefer LocalParticipant API if available
      if (
        isLocal &&
        room?.localParticipant &&
        typeof (room.localParticipant as any).setScreenShareEnabled === 'function'
      ) {
        await (room.localParticipant as any).setScreenShareEnabled(false);
      }
    } catch {}
  };

  return (
      <div
      className={cn(
        'relative bg-black border-2 border-default overflow-hidden transition-all duration-200 touch-manipulation',
        state?.isMinimized && '!h-16',
      )}
      style={{ width, height: state?.isMinimized ? 64 : height, borderRadius }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {/* Screen share video */}
      {screenTrackRef && !screenPub?.isMuted ? (
        <VideoTrack
          trackRef={screenTrackRef}
          playsInline
          className={cn(
            'w-full h-full',
            fit === 'contain' ? 'object-contain bg-black' : 'object-cover',
          )}
        />
      ) : (
        <div className="absolute inset-0 bg-surface-elevated flex items-center justify-center text-secondary">
          <div className="flex flex-col items-center gap-2">
            <ScreenShare className="w-10 h-10 opacity-75" />
            <div className="text-sm opacity-80">
              {isLocal ? 'Start screen share' : 'No screen share'}
            </div>
          </div>
        </div>
      )}

      {/* Header name */}
      {showParticipantName && targetParticipant && (
        <div className="absolute top-2 left-2">
          <div className="bg-black/60 backdrop-blur-sm rounded-md px-2 py-1 text-white text-xs font-medium">
            {targetParticipant.name || targetParticipant.identity}
          </div>
        </div>
      )}

      {/* Overlay controls */}
      <div
        className={cn(
          'absolute inset-0 pointer-events-none select-none transition-opacity duration-200',
          overlayVisible ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div className="absolute bottom-2 right-2 pointer-events-auto">
          <div className="bg-black/55 backdrop-blur-md rounded-lg p-1.5 flex items-center gap-1 shadow-lg">
            {isLocal && (
              <button
                aria-label="Stop sharing"
                onClick={stopShare}
                className="w-9 h-9 rounded-md grid place-items-center bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LivekitScreenShareTile;
