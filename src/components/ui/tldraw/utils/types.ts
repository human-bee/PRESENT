import type { createLiveKitBus } from '@/lib/livekit/livekit-bus';

export type LiveKitBus = ReturnType<typeof createLiveKitBus>;
