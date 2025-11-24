import { systemRegistry } from '../system-registry';
/**
 * Bridges SystemRegistry state events to LiveKit data channel messages and back.
 */
export class LiveKitStateBridge {
    constructor(room) {
        this.topic = 'state_change';
        this.room = room;
    }
    start() {
        // listen for messages from others
        this.room.on('dataReceived', (payload, participant) => {
            try {
                const decoded = JSON.parse(new TextDecoder().decode(payload));
                if (!decoded || !decoded.kind)
                    return;
                // Avoid echo loop – ignore messages we originated
                if (decoded.origin === 'browser' && participant.isLocal)
                    return;
                systemRegistry.ingestState(decoded);
            }
            catch (_) {
                /* ignore non JSON */
            }
        });
        // listen to local state updates and broadcast
        systemRegistry.onState(async (env) => {
            // Only broadcast if we are the originator
            if (env.origin !== 'browser')
                return;
            try {
                const msg = JSON.stringify(env);
                await this.room.localParticipant.publishData(new TextEncoder().encode(msg), {
                    reliable: true,
                    topic: this.topic,
                });
            }
            catch (error) {
                // Silently ignore if the connection is closed
                if (error instanceof Error && error.message.includes('PC manager is closed')) {
                    // Connection is closed, this is expected when room is disconnecting
                    return;
                }
                console.warn('[LiveKit State Bridge] Failed to publish data:', error);
            }
        });
    }
}
//# sourceMappingURL=livekit-state-bridge.js.map