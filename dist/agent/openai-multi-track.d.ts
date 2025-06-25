import * as openai from '@livekit/agents-plugin-openai';
/**
 * MultiTrackRealtimeModel decorates the stock RealtimeModel so that
 * additional remote audio tracks are fed into the Worklet as soon as
 * they are published.
 */
export declare class MultiTrackRealtimeModel extends openai.realtime.RealtimeModel {
    constructor(opts: ConstructorParameters<typeof openai.realtime.RealtimeModel>[0]);
    /**
     * Inject extra tracks after the model has been started.
     * The underlying AudioHandler already exposes `addTrack`.
     */
    addTrack(track: any): void;
}
/**
 * Utility that wires the model up to a LiveKit room so *every* future
 * audio publication is added to the model's mixer.
 */
export declare function wireRoomTracks(room: any, model: MultiTrackRealtimeModel): void;
//# sourceMappingURL=openai-multi-track.d.ts.map