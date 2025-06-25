import * as openai from '@livekit/agents-plugin-openai';
import { Track, RoomEvent } from 'livekit-client';

/**
 * MultiTrackRealtimeModel decorates the stock RealtimeModel so that
 * additional remote audio tracks are fed into the Worklet as soon as
 * they are published.
 */
export class MultiTrackRealtimeModel extends openai.realtime.RealtimeModel {
  constructor(opts: ConstructorParameters<typeof openai.realtime.RealtimeModel>[0]) {
    super(opts);
  }

  /**
   * Inject extra tracks after the model has been started.
   * The underlying AudioHandler already exposes `addTrack`.
   */
  addTrack(track: any) {
    // @ts-ignore – audioHandler is private on the original class.
    const audioHandler = (this as any).audioHandler;
    if (audioHandler && typeof audioHandler.addTrack === 'function') {
      console.log('🎵 [MultiTrack] Adding audio track to model mixer');
      audioHandler.addTrack(track);
    } else {
      console.warn('⚠️ [MultiTrack] AudioHandler or addTrack method not found');
    }
  }
}

/**
 * Utility that wires the model up to a LiveKit room so *every* future
 * audio publication is added to the model's mixer.
 */
export function wireRoomTracks(room: any, model: MultiTrackRealtimeModel) {
  console.log('🔌 [MultiTrack] Wiring room tracks to multi-track model');
  
  const subscribeToPublication = async (pub: any, participant: any) => {
    if ((pub.kind ?? pub.trackKind) === Track.Kind.Audio || pub.kind === 'audio') {
      try {
        await pub.setSubscribed(true);
        console.log(`🔊 [MultiTrack] Subscribed to ${participant.identity}'s audio track`);
        
        // Wait for the actual media track
        const track = await pub.trackPromise;
        if (track && track.mediaStreamTrack) {
          console.log(`🎧 [MultiTrack] Adding ${participant.identity}'s track to model mixer`);
          model.addTrack(track.mediaStreamTrack);
        } else {
          console.warn(`⚠️ [MultiTrack] No media track found for ${participant.identity}`);
        }
      } catch (error) {
        console.error(`❌ [MultiTrack] Failed to subscribe to ${participant.identity}'s audio:`, error);
      }
    }
  };

  // Subscribe to already-published tracks
  let trackCount = 0;
  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.trackPublications.values()) {
      subscribeToPublication(pub, participant);
      trackCount++;
    }
  }
  
  console.log(`📊 [MultiTrack] Found ${trackCount} existing audio publications`);

  // Subscribe to future tracks
  room.on(RoomEvent.TrackPublished, subscribeToPublication as any);
  
  // Enhanced logging for track events
  room.on(RoomEvent.TrackSubscribed, (track: any, pub: any, participant: any) => {
    if (track.kind === Track.Kind.Audio) {
      console.log(`✅ [MultiTrack] Successfully subscribed to ${participant.identity}'s audio track`);
    }
  });
} 