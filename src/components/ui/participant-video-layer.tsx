import * as React from 'react';
import { Bot, User, VideoOff } from 'lucide-react';
import { VideoTrack } from '@livekit/components-react';
import { cn } from '@/lib/utils';
import type { ParticipantTracks } from '@/hooks/use-participant-tracks';

type ParticipantVideoLayerProps = {
  showVideo: boolean;
  isMinimized: boolean;
  videoTrackRef: ParticipantTracks['videoTrackRef'];
  videoPublication: ParticipantTracks['videoPublication'];
  isLocal: boolean;
  mirrorLocal: boolean;
  fit: 'cover' | 'contain';
  isAgent: boolean;
};

export function ParticipantVideoLayer({
  showVideo,
  isMinimized,
  videoTrackRef,
  videoPublication,
  isLocal,
  mirrorLocal,
  fit,
  isAgent,
}: ParticipantVideoLayerProps) {
  if (!showVideo || isMinimized) return null;

  if (videoTrackRef && !videoPublication?.isMuted) {
    return (
      <div
        className={cn('absolute inset-0 w-full h-full', isLocal && mirrorLocal && '[transform:scaleX(-1)]')}
        style={{ transformOrigin: 'center' }}
      >
        <VideoTrack
          trackRef={videoTrackRef}
          playsInline
          className={cn('w-full h-full bg-black', fit === 'contain' ? 'object-contain' : 'object-cover')}
        />
      </div>
    );
  }

  if (videoPublication && videoPublication.isMuted) {
    return (
      <div
        className={cn('absolute inset-0 bg-gray-900 flex items-center justify-center', isLocal && mirrorLocal && '[transform:scaleX(-1)]')}
        style={{ transformOrigin: 'center' }}
      >
        <div className="text-center text-white">
          <VideoOff className="w-12 h-12 mx-auto mb-2 opacity-75" />
          <p className="text-sm opacity-75">Video disabled</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn('absolute inset-0 bg-gray-800 flex items-center justify-center', isLocal && mirrorLocal && '[transform:scaleX(-1)]')}
      style={{ transformOrigin: 'center' }}
    >
      <div className="text-center text-white">
        {isAgent ? (
          <Bot className="w-12 h-12 mx-auto mb-2 opacity-75" />
        ) : (
          <User className="w-12 h-12 mx-auto mb-2 opacity-75" />
        )}
        <p className="text-sm opacity-75">{isLocal ? 'Click camera to enable' : 'No video'}</p>
      </div>
    </div>
  );
}
