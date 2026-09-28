# Native PRESENT cloud readiness — 28 September 2026

The native build and signed HTTP/WebSocket contracts pass locally. No hosted version was deployed or verified during this QA run. The project remains a Node service, not a static website.

## Runtime contract

Use Node 22.12 or later and a single long-lived process. Build with `npm ci` and `npm run build`; start with `npm start`. The runtime uses `tsx`, so retain the dependencies needed by that command. Configure a persistent private filesystem for `PRESENT_DATA_DIRECTORY` and `PRESENT_ACCESS_DIRECTORY`, then supply:

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

The proxy must pass the canonical Host/Origin, WebSocket upgrades and unbuffered SSE. Healthcheck `GET /api/health` uses that canonical Host. There is one writer per data directory; horizontal replicas and a shared network filesystem are unsupported. Back up access records, room snapshots and assets together. Secrets and private room data must never enter a frontend bundle.

The managed development preview uses an isolated signed profile, private disposable data and an exact development-only origin. That exception is rejected under `NODE_ENV=production`.

## What still blocks the complete hosted product

- The shared work queue needs the per-job authorization adapter in [work-authorization-integration.md](work-authorization-integration.md). Its enable flag is intentionally unset. Hosted work routes fail closed; project metadata is readable by signed users, not permission to execute projects.
- Live voice, TTS playback, physical media, multi-human browser convergence and visual layout were not verified in this environment. Browser installation failed and the managed browser could not navigate to the preview. Provider secrets were not available to this local runtime.
- Sites' worker/static runtime cannot directly execute this Node WebSocket server and its filesystem-backed room/access stores. A durable realtime backend or a deliberate server/storage migration is required. Uploading the frontend alone would not provide a working room.
- The client still has a large tldraw entry chunk. Deferred LiveKit reduces initial transfer; it does not prove subsecond cold loading over a real network.

## Existing cloud infrastructure inspected

The connected Railway project `present-prod` contains older services. On this date, `present-conductor` and `present-realtime` reported successful April deployments; `present-codex-broker`, `present-widget-codex` and `present-railtail` reported failed September 18 deployments.

The widget service's build log identifies a concrete failure in the older Next.js tree: `src/lib/fairy-intent/jev-router.ts:81`, comparing indexed `unknown` probabilities. This file is not part of the native RoomOS tree. The failing build must be repaired on its own branch; it was not fixed or redeployed here. The other failed services' individual causes were not verified.

The realtime service lists existing OpenAI, Cerebras and LiveKit variable names. Values are withheld by the connected account, so their presence is not proof of validity and they were not copied to this runtime. No existing deployment, service, secret, domain or volume was changed.

## Release acceptance

Run the browser commands in the QA report against an isolated staging room. Verify owner/editor/viewer flows, revocation, reconnect after a process restart, durable assets, genuine spoken tool calls and received audible responses. Record click-to-visible, peer-visible and speech-to-result percentiles separately. Promote only after those checks and the required background-work adapter are complete.
