import * as openai from '@livekit/agents-plugin-openai';
import { Track, RoomEvent } from 'livekit-client';
/**
 * MultiTrackRealtimeModel decorates the stock RealtimeModel so that
 * additional remote audio tracks are fed into the Worklet as soon as
 * they are published.
 */
export class MultiTrackRealtimeModel extends openai.realtime.RealtimeModel {
    constructor(opts) {
        super(opts);
    }
    /**
     * Inject extra tracks after the model has been started.
     * The underlying AudioHandler already exposes `addTrack`.
     */
    addTrack(track) {
        // @ts-ignore – audioHandler is private on the original class.
        const audioHandler = this.audioHandler;
        console.log('🔍 [MultiTrack] Attempting to add track:', {
            hasAudioHandler: !!audioHandler,
            audioHandlerType: typeof audioHandler,
            hasAddTrackMethod: audioHandler && typeof audioHandler.addTrack === 'function',
            trackType: typeof track,
            track: track
        });
        if (audioHandler && typeof audioHandler.addTrack === 'function') {
            console.log('🎵 [MultiTrack] Adding audio track to model mixer');
            try {
                audioHandler.addTrack(track);
                console.log('✅ [MultiTrack] Track added successfully');
            }
            catch (error) {
                console.error('❌ [MultiTrack] Error adding track:', error);
            }
        }
        else {
            console.warn('⚠️ [MultiTrack] AudioHandler or addTrack method not found');
            console.warn('🔍 [MultiTrack] Available methods on audioHandler:', audioHandler ? Object.getOwnPropertyNames(audioHandler) : 'none');
        }
    }
}
/**
 * Utility that wires the model up to a LiveKit room so *every* future
 * audio publication is added to the model's mixer.
 */
export function wireRoomTracks(room, model) {
    console.log('🔌 [MultiTrack] Wiring room tracks to multi-track model');
    const subscribeToPublication = async (pub, participant) => {
        if ((pub.kind ?? pub.trackKind) === Track.Kind.Audio || pub.kind === 'audio') {
            try {
                await pub.setSubscribed(true);
                console.log(`🔊 [MultiTrack] Subscribed to ${participant.identity}'s audio track`);
                // Wait for the actual media track
                const track = await pub.trackPromise;
                console.log(`🔍 [MultiTrack] Track details for ${participant.identity}:`, {
                    hasTrack: !!track,
                    trackType: typeof track,
                    hasMediaStreamTrack: track && !!track.mediaStreamTrack,
                    mediaStreamTrackType: track && typeof track.mediaStreamTrack,
                    publicationKind: pub.kind,
                    publicationName: pub.name || pub.trackName
                });
                if (track && track.mediaStreamTrack) {
                    console.log(`🎧 [MultiTrack] Adding ${participant.identity}'s track to model mixer`);
                    model.addTrack(track.mediaStreamTrack);
                }
                else {
                    console.warn(`⚠️ [MultiTrack] No media track found for ${participant.identity}`, {
                        track: track,
                        mediaStreamTrack: track?.mediaStreamTrack
                    });
                }
            }
            catch (error) {
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
    room.on(RoomEvent.TrackPublished, subscribeToPublication);
    // Enhanced logging for track events
    room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
            console.log(`✅ [MultiTrack] Successfully subscribed to ${participant.identity}'s audio track`);
        }
    });
}
//# sourceMappingURL=openai-multi-track.js.map