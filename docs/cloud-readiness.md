# Native PRESENT cloud readiness — 29 September 2026

The native build, signed HTTP/WebSocket contracts and provider-free Chromium UI tests run locally and in GitHub Actions. An isolated Railway staging service and persistent volume are configured; deployment and hosted browser verification are still pending. The project remains a Node service, not a static website.

## Runtime contract

Use Node 24 or later and a single long-lived process. Build with `npm ci` and `npm run build`; start with `npm start`, or use the included Dockerfile. The runtime uses `tsx`, so retain the dependencies needed by that command. Configure a persistent private filesystem for `PRESENT_DATA_DIRECTORY` and `PRESENT_ACCESS_DIRECTORY`, then supply:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PRESENT_HOST` | `0.0.0.0` for a container; loopback behind a local proxy |
| `PRESENT_PORT` | Platform target port, e.g. `4317` |
| `PRESENT_ACCESS_MODE` | `invite` |
| `PRESENT_ACCESS_ORIGIN` | Exact external HTTPS origin, no trailing slash |
| `PRESENT_ACCESS_SECRET` | Stable high-entropy operator secret, at least 32 bytes |
| `PRESENT_DATA_DIRECTORY` | Private durable mount, outside static roots |
| `PRESENT_ACCESS_DIRECTORY` | Private durable access-record directory |
| `CEREBRAS_API_KEY` | Hosted room generation |
| `OPENAI_API_KEY` | Realtime voice and image functionality |
| `TYPESAFE_API_KEY` | Optional JEV routing |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Human calls |

The proxy must pass the canonical Host/Origin, WebSocket upgrades and unbuffered SSE. Use `GET /healthz` for platform probes: it returns only liveness and needs no canonical Host. `GET /api/health` retains the canonical Host restriction. There is one writer per data directory; horizontal replicas and a shared network filesystem are unsupported. An OS-backed SQLite lock releases automatically after a crash. A legacy `access.lock` is never bypassed: stop and verify the old writer before migrating. Back up access records, room snapshots and assets together. Secrets and private room data must never enter a frontend bundle.

Completed work flushes its canvas artifact before recording terminal success. Room snapshots use atomic replacement and file/directory fsync. Ordinary canvas edits still use a 150 ms debounce; the last debounce window can be lost on abrupt process death. This is not a zero-loss write-ahead journal.

The managed development preview uses an isolated signed profile, private disposable data and an exact development-only origin. That exception is rejected under `NODE_ENV=production`.

## What still blocks the complete hosted product

- Per-job hosted work authorization is integrated and tested across queued actors, revocation, expiry, late callbacks, and restart. Execution still needs a configured, authenticated provider; an enabled route does not imply an available Codex runtime.
- Real multi-participant browser convergence and desktop/mobile layout were verified in GitHub Actions after the local browser installation was blocked. Genuine speech, TTS playback and LiveKit calls remain unverified: provider credentials are unavailable to this QA runtime. The live suites are opt-in and are explicitly skipped in CI.
- Sites' worker/static runtime cannot directly execute this Node WebSocket server and its filesystem-backed room/access stores. A durable realtime backend or a deliberate server/storage migration is required. Uploading the frontend alone would not provide a working room.
- The client still has a large tldraw entry chunk. Deferred LiveKit reduces initial transfer; it does not prove subsecond cold loading over a real network.

## Existing cloud infrastructure inspected

The connected Railway project `present-prod` contains older services. On this date, `present-conductor` and `present-realtime` reported successful April deployments; `present-codex-broker`, `present-widget-codex` and `present-railtail` reported failed September 18 deployments.

The widget service's build log identifies a concrete failure in the older Next.js tree: `src/lib/fairy-intent/jev-router.ts:81`, comparing indexed `unknown` probabilities. This file is not part of the native RoomOS tree. The failing build must be repaired on its own branch; it was not fixed or redeployed here. The other failed services' individual causes were not verified.

The realtime service lists existing OpenAI, Cerebras and LiveKit variable names. Values are withheld by the connected account, so their presence is not proof of validity and they were not copied to this runtime. No existing deployment, service, secret, domain or volume was changed.

## Release acceptance

The provider-free browser commands and evidence are in the QA report. Repeat them against an isolated deployed staging room. Then verify reconnect after a process restart, durable assets, genuine spoken tool calls and received audible responses. Record click-to-visible, peer-visible and speech-to-result percentiles separately. Promote only after those checks are complete.
