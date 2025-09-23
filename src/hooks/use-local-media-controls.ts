import * as React from 'react';
import type { LocalParticipant, RemoteParticipant } from 'livekit-client';
import { useRoomContext, useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';

export type ParticipantEntity = RemoteParticipant | LocalParticipant;

export function useLocalMediaControls(
  participant: ParticipantEntity,
  isLocal: boolean,
  audioMuted: boolean,
  videoMuted: boolean,
) {
  const room = useRoomContext();
  const micToggle = useTrackToggle(Track.Source.Microphone);
  const cameraToggle = useTrackToggle(Track.Source.Camera);

  const toggleLocalMicrophone = React.useCallback(async () => {
    if (!isLocal) return;
    const nextEnabled = audioMuted;
    type LocalMicControl = {
      setMicrophoneEnabled?: (enabled: boolean) => Promise<void>;
    };
    const localControls = participant as unknown as LocalMicControl | null;
    if (localControls?.setMicrophoneEnabled) {
      try {
        await localControls.setMicrophoneEnabled(nextEnabled);
        return;
      } catch {}
    }
    const roomControls = room?.localParticipant as unknown as LocalMicControl | null;
    if (roomControls?.setMicrophoneEnabled) {
      try {
        await roomControls.setMicrophoneEnabled(nextEnabled);
        return;
      } catch {}
    }
    try {
      await micToggle?.toggle();
    } catch {}
  }, [audioMuted, isLocal, micToggle, participant, room]);

  const toggleLocalCamera = React.useCallback(async () => {
    if (!isLocal) return;
    const nextEnabled = videoMuted;
    type LocalCameraControl = {
      setCameraEnabled?: (enabled: boolean) => Promise<void>;
    };
    const localControls = participant as unknown as LocalCameraControl | null;
    if (localControls?.setCameraEnabled) {
      try {
        await localControls.setCameraEnabled(nextEnabled);
        return;
      } catch {}
    }
    const roomControls = room?.localParticipant as unknown as LocalCameraControl | null;
    if (roomControls?.setCameraEnabled) {
      try {
        await roomControls.setCameraEnabled(nextEnabled);
        return;
      } catch {}
    }
    try {
      await cameraToggle?.toggle();
    } catch {}
  }, [isLocal, videoMuted, cameraToggle, participant, room]);

  return {
    toggleLocalMicrophone,
    toggleLocalCamera,
  };
}
