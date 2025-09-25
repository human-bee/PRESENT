import * as React from 'react';
import { useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { LocalParticipant, RemoteParticipant } from 'livekit-client';

export type ParticipantEntity = RemoteParticipant | LocalParticipant;

export type ParticipantTracks = {
  videoTrackRef: ReturnType<typeof useTracks>[number] | undefined;
  audioTrackRef: ReturnType<typeof useTracks>[number] | undefined;
  screenTrackRef: ReturnType<typeof useTracks>[number] | undefined;
  videoPublication: ReturnType<typeof useTracks>[number]['publication'] | undefined;
  audioPublication: ReturnType<typeof useTracks>[number]['publication'] | undefined;
};

export function useParticipantTracks(
  participant: ParticipantEntity,
  trackPreference: 'auto' | 'camera' | 'screen',
): ParticipantTracks {
  const trackRefs = useTracks(
    [Track.Source.Camera, Track.Source.Microphone, Track.Source.ScreenShare],
    { onlySubscribed: false },
  );

  const cameraTrackRef = React.useMemo(
    () =>
      trackRefs.find(
        (t) => t.participant?.identity === participant.identity && t.source === Track.Source.Camera,
      ),
    [trackRefs, participant.identity],
  );

  const audioTrackRef = React.useMemo(
    () =>
      trackRefs.find(
        (t) => t.participant?.identity === participant.identity && t.source === Track.Source.Microphone,
      ),
    [trackRefs, participant.identity],
  );

  const screenTrackRef = React.useMemo(
    () =>
      trackRefs.find(
        (t) =>
          t.participant?.identity === participant.identity && t.source === Track.Source.ScreenShare,
      ),
    [trackRefs, participant.identity],
  );

  const videoTrackRef = React.useMemo(() => {
    if (trackPreference === 'camera') return cameraTrackRef;
    if (trackPreference === 'screen') return screenTrackRef || cameraTrackRef;
    if (screenTrackRef && !screenTrackRef.publication?.isMuted) return screenTrackRef;
    return cameraTrackRef;
  }, [cameraTrackRef, screenTrackRef, trackPreference]);

  return {
    videoTrackRef,
    audioTrackRef,
    screenTrackRef,
    videoPublication: videoTrackRef?.publication,
    audioPublication: audioTrackRef?.publication,
  };
}
