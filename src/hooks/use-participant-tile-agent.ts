'use client';

import * as React from 'react';
import {
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  useTracks,
  useTrackToggle,
} from '@livekit/components-react';
import { ConnectionQuality, Track } from 'livekit-client';

export interface ParticipantTileAgentContext {
  participantId: string;
  isLocal: boolean;
}

export interface ParticipantTileAgentEvents {
  toggleMic(): Promise<boolean>; // returns new enabled state (true = unmuted)
  toggleCamera(): Promise<boolean>; // returns new enabled state
  toggleScreenShare(): Promise<boolean>; // returns new sharing state
  setQuality(level: 'auto' | 'low' | 'high'): Promise<void>;
}

export interface ParticipantTileAgentState {
  audioMuted: boolean;
  videoMuted: boolean;
  screenSharing: boolean;
  isSpeaking: boolean;
  connectionQuality?: 'poor' | 'good' | 'excellent';
}

export function useParticipantTileAgent(ctx: ParticipantTileAgentContext): {
  state: ParticipantTileAgentState;
  events: ParticipantTileAgentEvents;
} {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  const participant = React.useMemo(() => {
    if (!ctx.participantId) return null as any;
    if (ctx.isLocal) return localParticipant ?? null;
    return participants.find((p) => p.identity === ctx.participantId) ?? null;
  }, [participants, localParticipant, ctx.participantId, ctx.isLocal]);

  // Live track refs for audio/video/screen
  const trackRefs = useTracks(
    [Track.Source.Microphone, Track.Source.Camera, Track.Source.ScreenShare],
    {
      onlySubscribed: false,
    },
  );

  const videoPub = React.useMemo(
    () =>
      trackRefs.find(
        (t) => t.participant?.identity === ctx.participantId && t.source === Track.Source.Camera,
      )?.publication,
    [trackRefs, ctx.participantId],
  );
  const audioPub = React.useMemo(
    () =>
      trackRefs.find(
        (t) =>
          t.participant?.identity === ctx.participantId && t.source === Track.Source.Microphone,
      )?.publication,
    [trackRefs, ctx.participantId],
  );
  const screenPub = React.useMemo(
    () =>
      trackRefs.find(
        (t) =>
          t.participant?.identity === ctx.participantId && t.source === Track.Source.ScreenShare,
      )?.publication,
    [trackRefs, ctx.participantId],
  );

  // Local toggles
  const micToggle = useTrackToggle({ source: Track.Source.Microphone });
  const cameraToggle = useTrackToggle({ source: Track.Source.Camera });
  const screenToggle = useTrackToggle({ source: Track.Source.ScreenShare });

  // Debounced speaking state to reduce jitter
  const [speaking, setSpeaking] = React.useState(false);
  const speakingTimer = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!participant) return;
    const next = !!participant.isSpeaking;
    // Simple debounce window of 120ms to avoid rapid flicker
    if (speakingTimer.current) window.clearTimeout(speakingTimer.current);
    speakingTimer.current = window.setTimeout(() => setSpeaking(next), 120);
    return () => {
      if (speakingTimer.current) window.clearTimeout(speakingTimer.current);
    };
  }, [participant?.isSpeaking]);

  // Connection quality normalization
  const quality: ParticipantTileAgentState['connectionQuality'] = React.useMemo(() => {
    const q = participant?.connectionQuality;
    switch (q) {
      case ConnectionQuality.Poor:
        return 'poor';
      case ConnectionQuality.Good:
        return 'good';
      case ConnectionQuality.Excellent:
        return 'excellent';
      default:
        return undefined;
    }
  }, [participant?.connectionQuality]);

  const [publishQuality, setPublishQuality] = React.useState<'auto' | 'low' | 'high'>('auto');

  const localMicEnabled: boolean | undefined =
    ctx.isLocal && room?.localParticipant
      ? (room!.localParticipant as any).isMicrophoneEnabled
      : undefined;
  const localCamEnabled: boolean | undefined =
    ctx.isLocal && room?.localParticipant
      ? (room!.localParticipant as any).isCameraEnabled
      : undefined;
  const localScreenEnabled: boolean | undefined =
    ctx.isLocal && room?.localParticipant
      ? (room!.localParticipant as any).isScreenShareEnabled
      : undefined;

  const audioEnabledGuess =
    localMicEnabled !== undefined
      ? localMicEnabled
      : (micToggle?.enabled ?? (audioPub ? !audioPub.isMuted : true));
  const videoEnabledGuess =
    localCamEnabled !== undefined
      ? localCamEnabled
      : (cameraToggle?.enabled ?? (videoPub ? !videoPub.isMuted : true));

  const state: ParticipantTileAgentState = {
    audioMuted: !audioEnabledGuess,
    videoMuted: !videoEnabledGuess,
    screenSharing:
      localScreenEnabled !== undefined ? localScreenEnabled : !!screenPub && !screenPub.isMuted,
    isSpeaking: speaking,
    connectionQuality: quality,
  };

  const events: ParticipantTileAgentEvents = {
    async toggleMic() {
      if (!ctx.isLocal) return audioEnabledGuess;
      try {
        // Prefer direct LiveKit API for reliability
        const currentlyMuted = !audioEnabledGuess;
        if (
          room?.localParticipant &&
          typeof room.localParticipant.setMicrophoneEnabled === 'function'
        ) {
          await room.localParticipant.setMicrophoneEnabled(!currentlyMuted);
          return !currentlyMuted;
        } else {
          await micToggle?.toggle();
          return !currentlyMuted;
        }
      } catch {
        return audioEnabledGuess;
      }
    },
    async toggleCamera() {
      if (!ctx.isLocal) return videoEnabledGuess;
      try {
        const currentlyMuted = !videoEnabledGuess;
        if (
          room?.localParticipant &&
          typeof room.localParticipant.setCameraEnabled === 'function'
        ) {
          await room.localParticipant.setCameraEnabled(!currentlyMuted);
          return !currentlyMuted;
        } else {
          await cameraToggle?.toggle();
          return !currentlyMuted;
        }
      } catch {
        return videoEnabledGuess;
      }
    },
    async toggleScreenShare() {
      if (!ctx.isLocal) return state.screenSharing;
      try {
        const isActive = !!screenPub && !screenPub.isMuted;
        // Some SDKs expose direct control on localParticipant
        // Fallback to hook toggle if not available
        if (
          room?.localParticipant &&
          typeof (room.localParticipant as any).setScreenShareEnabled === 'function'
        ) {
          await (room.localParticipant as any).setScreenShareEnabled(!isActive);
          return !isActive;
        } else {
          await screenToggle?.toggle();
          return !isActive;
        }
      } catch {
        return !state.screenSharing;
      }
    },
    async setQuality(level: 'auto' | 'low' | 'high') {
      // Best-effort mapping; LiveKit doesn’t expose simple global quality toggles at runtime.
      // We keep state for UI and try to adjust subscription profile if available.
      setPublishQuality(level);
      try {
        if (room && typeof (room as any).setDefaultSubscriptionProfile === 'function') {
          const profile = level === 'high' ? 'high' : level === 'low' ? 'low' : 'balanced';
          await (room as any).setDefaultSubscriptionProfile(profile);
        }
      } catch {}
    },
  };

  return { state, events };
}
