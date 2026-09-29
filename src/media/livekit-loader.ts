import type * as LiveKit from 'livekit-client';

export type LiveKitSDK = typeof LiveKit;
let pending: Promise<LiveKitSDK> | null = null;
let loaded: LiveKitSDK | null = null;

/** Loads the optional call SDK once. A rejected load is cleared so a later attempt can retry. */
export function loadLiveKit(): Promise<LiveKitSDK> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = import('livekit-client').then((sdk) => { loaded = sdk; return sdk; })
      .catch((error) => { pending = null; throw error; });
  }
  return pending;
}

/** Call from a user-intent event (hover/focus/touchstart) to warm the chunk before a call. */
export function preloadLiveKit(): Promise<void> { return loadLiveKit().then(() => undefined); }

export function resetLiveKitLoaderForTests() { pending = null; loaded = null; }
