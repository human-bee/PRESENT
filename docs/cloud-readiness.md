# Native PRESENT cloud readiness — 29 September 2026

The native build, signed HTTP/WebSocket contracts and provider-free Chromium UI tests run locally and in GitHub Actions. Isolated Railway staging is deployed at https://present-native-production.up.railway.app with a persistent 5 GB volume and a verified HTTP health response. **Hosted UI acceptance is blocked by the missing tldraw production license, not certified ready for demonstrations.** The installed SDK hides an unlicensed production editor after five seconds; PRESENT now explains the missing input instead of opening a disappearing canvas. The project remains a Node service, not a static website.

## Runtime contract

Use Node 24 or later and a single long-lived process. Build with `npm ci` and `npm run build`; start with `npm start`, or use the included Dockerfile. The runtime uses `tsx`, so retain the dependencies needed by that command. Configure a persistent private filesystem for `PRESENT_DATA_DIRECTORY` and `PRESENT_ACCESS_DIRECTORY`, then supply:

| Setting | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PRESENT_HOST` | `0.0.0.0` for a container; loopback behind a local proxy |
| `PRESENT_PORT` | Platform target port, e.g. `4317` |
| `PORT` | On Railway, match `PRESENT_PORT` so the health probe reaches the listener |
| `PRESENT_ACCESS_MODE` | `invite` |
| `PRESENT_ACCESS_ORIGIN` | Exact external HTTPS origin, no trailing slash |
| `PRESENT_ACCESS_SECRET` | Stable high-entropy operator secret, at least 32 bytes |
| `PRESENT_DATA_DIRECTORY` | Private durable mount, outside static roots |
| `PRESENT_ACCESS_DIRECTORY` | Private durable access-record directory |
| `VITE_TLDRAW_LICENSE_KEY` | Valid public tldraw license, supplied at build time; Docker declares this build argument |
| `PRESENT_MODEL_TRANSPORT` | Set explicitly to `openai` for paid OpenAI Responses planning; otherwise preserve the local Codex subscription adapter |
| `CEREBRAS_API_KEY` | Optional Cerebras room generation |
| `OPENAI_API_KEY` | GPT Live, images, and Responses planning when explicitly enabled |
| `TYPESAFE_API_KEY` | Optional JEV routing |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Human calls |

The proxy must pass the canonical Host/Origin, WebSocket upgrades and unbuffered SSE. Use `GET /healthz` for platform probes: it returns liveness and, on Railway, the public source revision; it needs no canonical Host. CI waits for the requested revision, not an older healthy deployment. `GET /api/health` retains the canonical Host restriction. There is one writer per data directory; horizontal replicas and a shared network filesystem are unsupported. An OS-backed SQLite lock releases automatically after a crash. A legacy `access.lock` is never bypassed: stop and verify the old writer before migrating. Back up access records, room snapshots and assets together. API secrets and private room data must never enter a frontend bundle. The tldraw license is intentionally a public client-side key.

With `PRESENT_MODEL_TRANSPORT=openai`, Luna, Terra and Astra use server-side Responses with the existing strict output contracts. Settings discover actual project-visible model IDs and never launch a local Codex process in hosted mode. A fresh visitor defaults to the operator-selected transport (Luna for OpenAI); an existing saved preference is not silently replaced. Select an available model in Room settings if needed. API responses have bounded size, duration and output-token budgets, no model host tools, no stored Responses, explicit cancellation and terminal-completion validation. Fast mode is an explicit paid tier choice. Spark and workspace execution still require an authenticated Codex app-server; this planning adapter does not create a hosted code-execution environment. Provider contract tests use controlled responses and do not establish real model quality or account access.

Obtain or reuse an appropriate license through https://tldraw.dev/community/license. No license checks, watermarks, production detection, or domain restrictions are bypassed. A key requires rebuilding the frontend. Live voice additionally needs a securely supplied `OPENAI_API_KEY`; no key was created or recovered from another service during this work.

Completed work flushes its canvas artifact before recording terminal success. Room snapshots use atomic replacement and file/directory fsync. Ordinary canvas edits still use a 150 ms debounce; the last debounce window can be lost on abrupt process death. This is not a zero-loss write-ahead journal.

Widget state writes request compact HTTP receipts instead of downloading every widget's source on every keystroke. Canonical state and transaction receipts still arrive through native WebSocket sync; optimistic iframe edits are retired only by those native receipts. Other operation clients keep the full-room response by default. A `committed` receipt acknowledges the canonical transaction, not a disk flush. A hard reload can also discard a client edit that has not reached the server; reconnect tests establish a server-confirmed baseline before injecting a transport failure.

The sandbox reconciles every native update but emits `present:state` only when the visible state changes (plus its initial delivery). Receipt-only confirmations do not rebuild unrelated widgets. Render-receipt diagnostics and failed-edit rollback remain active; these acknowledgements are not compositor-paint guarantees.

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

Provider-free commands are defined in `.github/workflows/native-qa.yml`: `npm test`, `npm run build`, `npm run test:e2e`, and `npx playwright test --config tests/access-playwright.config.ts` / `tests/production-playwright.config.ts`. The recorded 20-minute, three-participant run uses `PRESENT_SOAK_SECONDS=1200 npx playwright test --config tests/soak-playwright.config.ts`; its history is explicitly synthetic and it does not call a speech or reasoning provider. Repeat hosted checks with `tests/cloud-playwright.config.ts` against the isolated deployed staging room. Then verify reconnect after a process restart, durable assets, genuine spoken tool calls and received audible responses. Record click-to-visible, peer-visible and speech-to-result percentiles separately. Promote only after those checks are complete.

For repeatable lower-level load testing, `PRESENT_BENCH_NOTES=100 PRESENT_BENCH_ROUNDS=1000 node --import tsx scripts/benchmarks/native-sync.ts` uses four real loopback WebSocket peers, 100 background notes, and 2,000 measured move/state updates plus 13 instrument creations. It uses its own temporary store and does not load-test the public staging project. It does not measure browser paint, real speech, provider reasoning or WAN delivery.
