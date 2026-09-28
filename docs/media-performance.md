# Media lazy-loading performance pass

## Result

The baseline build from commit `99fd64b` was measured with the same Node/npm/Vite environment as the change. The baseline had one initial JavaScript chunk: **2,865.11 kB raw / 851.60 kB gzip**. The changed build has an initial app chunk of **2,354.17 kB raw / 717.69 kB gzip** plus a deferred `livekit-client` chunk of **531.04 kB raw / 139.34 kB gzip**. Initial JavaScript falls by **510.94 kB raw / 133.91 kB gzip (15.7%)**; total JavaScript becomes **2,885.21 kB raw / 857.03 kB gzip**, roughly +20.10 kB raw / +5.43 kB gzip because of the loader boundary.

“Initial” means the app entry chunk requested for the first screen. “Total” includes the deferred LiveKit chunk downloaded after call use. Vite’s existing tldraw warning remains unrelated and no manual chunking was added.

## Behavior and integration

`src/media/livekit-loader.ts` owns one shared, retryable dynamic import. Concurrent callers receive the same promise, and a rejected import clears the promise for a subsequent retry. `MediaSession` does not construct a Room until the SDK is loaded, so concurrent device toggles share the existing `joining` promise. `disconnect()` advances the generation, aborts token fetch, and late SDK/token/capture completions stop tracks without publishing.

Screen capture is special: browser user activation cannot be guaranteed across an awaited dynamic import. `MediaSession.preload()` / `preloadLiveKit()` are the safe intent boundary. Wire it to an existing call affordance’s `pointerenter`, `focus`, or `touchstart` (without requesting permission); invoke `toggleScreen` from the actual click/tap. If the user clicks before preload finishes, the SDK still loads and the call remains functional, but the browser may reject the display permission as expected browser behavior. No automatic permission prompt is introduced.

No coordinator-owned files were changed. The coordinator should expose `preload` from `useMedia` if it wants intent preloading; the current session already has the typed method.

## Verification

```sh
npm run typecheck
node --import tsx --test --test-force-exit tests/media-session.test.ts
node scripts/benchmarks/media-loader.mjs
```

The deterministic fake boundary suite covers idle behavior, stop-winning pending capture, screen permission ordering, and duplicate device presses. The loader benchmark runs 20 concurrent cached loads after three warmups and reports p50/p95; it is not a browser network benchmark and does not represent first-download latency.
