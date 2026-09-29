# Invite profile: application integration

Based on `99fd64bd357caded31fd2d1a8b8195c31119bab8` from `codex/present-cloud-base-20260921`. This patch mounts the previously integrated access foundation. It preserves native tldraw sync, RoomOS, request recovery, room projection caching and the loopback developer profile. No deployment or provider calls are part of validation.

## Run profiles

With `PRESENT_ACCESS_MODE` unset or `local`, use the existing `npm run dev` loop at `http://127.0.0.1:4317`. Room links and local templates work. `localhost` remains the separate MCP sandbox origin; its APIs/assets/sockets cannot access the application. Hosted MCP, playbook and development benchmark routes are unavailable, with explicit errors.

For the invite profile, supply these values through the operator's environment or private environment file; no deployment secret is generated or included:

| Variable | Required value |
| --- | --- |
| `PRESENT_ACCESS_MODE` | `invite` |
| `PRESENT_ACCESS_SECRET` | Stable, operator-supplied high-entropy secret of at least 32 bytes |
| `PRESENT_ACCESS_ORIGIN` | Exact canonical HTTPS origin, e.g. `https://present.example.com`; no path/trailing slash |
| `PRESENT_ACCESS_DIRECTORY` | Absolute private durable directory for access records, outside static roots |
| `PRESENT_DATA_DIRECTORY` | Absolute private durable directory for native rooms, assets, jobs and templates |
| `NODE_ENV` | `production` for HTTPS hosting |
| `PRESENT_PORT` | Internal port, default `4317` |
| `PRESENT_HOST` | `127.0.0.1` by default; `0.0.0.0` is admitted only with the invite profile |

Build with `npm ci --ignore-scripts`, `node scripts/sync-assets.mjs`, then `npm run build`. With the environment above supplied, run `node --import tsx server/index.ts`. Container hosting can set `PRESENT_HOST=0.0.0.0`; local mode cannot. The operator's HTTPS reverse proxy must preserve the exact configured `Host` and browser `Origin`, support websocket upgrades and SSE, and disable buffering of the membership event stream. Forwarded host/origin headers are ignored. Do not route the private data directories as static content. HTTPS invite mode refuses to run the Vite source server.

For an isolated local invite check, the only supported HTTP origin is explicit `http://127.0.0.1:PORT`; omit `NODE_ENV=production` for the development UI. Set both data directories to disposable locations and provide a test-only secret. The browser smoke config does this automatically, clears provider configuration and never loads `.env.local`.

The bounded application limits are 12 new sessions/minute and 30 invite redemptions/minute per socket peer, with at most 2,048 rate-limit keys. Behind a single proxy these are intentionally aggregate limits; forwarded addresses do not bypass them. Existing valid sessions do not consume session-creation capacity. The access store additionally bounds sessions/rooms to 1,000 and members/invites per room to 1,000.

## User flow

The entry screen creates an anonymous, server-signed HttpOnly session, then creates a new owner room or explicitly redeems an invite. Visiting `/r/:roomId` verifies membership before mounting the canvas; room-ID knowledge cannot claim an existing room. The owner opens **Invite** to create a bounded editor/viewer link, review memberships/invitations and revoke either. Non-owners can leave. Invitation secrets are in `#invite=...`, removed before the app loads; GET/prefetch never consumes them.

The room panel contains built-ins and the current signed user's saved templates. Only the source room owner can export a layout. The existing privacy whitelist remains authoritative: no room history, transcripts, workspaces, private assets or membership data are copied. Instantiating creates a fresh access-owned room, checks again inside the native install transaction and navigates into its editable canvas. There is no shared global user catalog.

Viewers get native readonly sync, a view-only banner, canvas navigation and receive-only call joining. Edit/composer/voice/activity controls are hidden, embedded widget forms are disabled, and HTTP/socket enforcement remains authoritative. Display names remain user-chosen; identity and authority come from the signed session.

## Mounted security boundaries

`server/index.ts` selects the profile after environment loading. `createInviteProfile` wraps existing dispatch; `installNativeAccessGuard` decorates the application's public `RoomStore` boundary without changing the coordinator-owned store/cache implementation. `src/main.tsx` mounts `AccessApp`, which supplies signed identity to `App` and `useRoom`. Existing native canvas and request-recovery flows are retained.

- HTTP: exact Host, exact Origin for all mutations, no cross-site requests, bounded input, explicit API allowlist. Unknown/unscoped APIs deny access. Actors and voice/media participant identities are overwritten before existing handlers parse input. JSON room IDs must agree with path scopes.
- Room data: `RoomAuthorization.check(permission)` revalidates the signed session, current membership and role each time. Public store reads/writes/subscription deliveries check it; mutation audit actors use the signed member. System persistence/expiry sweeps retain their existing implementation. Do not retain a raw `TLSocketRoom` across an await without checking again before `updateStore`; the template installer does so inside its callback.
- Native sockets: authorization before room load/upgrade, transport IDs namespaced by signed user, signed presence IDs, native `isReadonly`/`objectAccess`, live checks before every inbound message and outbound send, and idle expiry/revocation watchers. Chunked native protocol messages still work, with bounded assembly. Revocation closes sockets with code 1008.
- Pending HTTP/provider operations: revocation destroys the response, triggering existing abort controllers; store/asset commits recheck current access after awaits. Request recovery is still keyed by its existing journal. It does not substitute for authorization.
- Activities: schedulers are isolated by room **and initiating identity** and closed on revocation. Scene playback creates a timer per control invocation and its frame commits cross the guarded store boundary. The separate shared WorkJobs queue requires the adapter described below.
- Browser lifecycle: a checked membership SSE stream unmounts canvas/media/voice on revocation or session expiry; SSE is bounded to 128 connections. Server checks remain effective if the browser ignores the event.

API exceptions are deliberate: `GET /api/profile` and `GET /api/health` are public metadata; session creation is rate-limited. `GET /api/agents`, `/api/activity/connectors`, and `/api/projects` require a valid signed session. The projects route grants catalog metadata only, **not** project execution or workspace access. Its coordinator-owned handler still needs mounting (below). Other room reads require membership; writes/tools require editor or owner; invites/revocation require owner.

## Assets

Invite assets have actual durable namespaces: `<PRESENT_DATA_DIRECTORY>/assets/rooms/<roomId>/<sha256>.<ext>` and `/api/assets/<roomId>/<sha256>.<ext>`. Browser uploads, generated images and imported web images use the same policy. GET, HEAD and range requests authorize that namespace before opening the file and use private/no-store caching. Upload checks again after receiving bytes; live streams close on revocation. Substituting another room ID only addresses that room's own directory; a room query cannot authorize arbitrary global hashes. Provider image references reject cross-room or legacy unassociated assets.

Existing global/local assets and old local rooms are not automatically claimed or published in invite mode. There is no migration based on a supplied room ID or hash. Asset limits remain per directory (25 MB upload, 512 MB/1,000 files for uploads); external generated-image routines retain their existing limits. Private storage requires operator capacity planning, not a public object-store fallback.

## Media revocation and its limits

`server/media-routes.ts` signs LiveKit tokens locally using the existing operator-supplied `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. Participant identity is the signed member. Viewers have `canPublish=false`, `canSubscribe=true`; data publishing is disabled. Admission tokens last at most 60 seconds and never beyond session expiry, with access checked again after signing.

`MediaRevocations` injects a `(roomId, userId) => Promise<void>` removal hook. The mounted implementation uses LiveKit `removeParticipant`, a five-second SDK timeout and no region failover. Revocation/expiry attempts immediate removal, then another sweep after the latest issued admission token expires plus a two-second clock margin. Each sweep has at most three attempts, five seconds per attempt and one-second backoff. At most 256 identities are tracked. Owner **Check call removal** reads the bounded state via `GET /api/access/rooms/:roomId/media`.

The UI intentionally reports **pending** through the admission window and **failed** if the final removal fails. A copied external JWT may reconnect during its remaining admission window. Immediate irreversible JWT revocation is not promised. Existing calls do not necessarily end merely because a JWT expires. Successful removal requires reachable provider service credentials and clocks consistent with the token issuer. A process restart loses in-memory leases; provider-level termination and monitoring remain necessary if an external call outlives the server. Session/room HTTP and native sync revocation remain effective independently.

Voice ownership leases are stopped server-side, and the browser unmount stops its realtime client. This patch does not add an OpenAI call-ID hangup mechanism or modify the separately owned voice transport/ownership modules; a malicious client retaining a direct external peer connection needs that provider-specific termination integration. It cannot continue using PRESENT tools, room reads or commits after revocation.

## Coordinator integration (required only for selected-project work)

The patch does not edit `server/agents/work-jobs.ts`, workspace modules, work contracts, voice transport or Luna's client media files. See [work-authorization-integration.md](work-authorization-integration.md) for exact start/resume/drain/checkpoint/commit hooks. Until those hooks are installed, hosted `/api/work/*` and work initiation through composer/voice/activities return a clear unavailable error. Local work behavior is unchanged. Do not call `enableHostedWorkAuthorization()` early.

Terra's `server/projects/routes.ts` is absent from this base, so it is not imported here. After applying onto the coordinator's combined tree, add its existing import and dispatch call:

```ts
import { handleProjectRequest } from './projects/routes';
// Inside server/index.ts dispatch, before the unknown-API response:
if (await handleProjectRequest(req, res)) return;
```

The invite profile already checks the signed session for **GET only** `/api/projects` before this dispatch. Keep the response restricted to `id/name/description`; workspace snapshots and diff evidence stay under their job's authorized room and initiating identity.

## Persistence and alpha lifecycle

Access mutations write a private temporary file, fsync it, rename atomically, fsync the directory and only then publish state. Failed/corrupt storage fails closed. The exclusive access lock requires one Node process and a local durable filesystem; do not run multiple writers or use shared NFS. Following an unclean exit, verify no writer is alive before removing only the stale `access.lock`. Back up access records alongside native room/assets/templates data.

Sessions expire after seven days by default. There is no account recovery/renewal/ownership transfer. Clearing the owner's cookie or rotating the deployment secret loses that identity's room management; plan the alpha within this window. Owners cannot leave. Leave/revoke creates permanent membership tombstones for that signed identity; consumed/revoked invites cannot replay. A newly created anonymous session is a new identity and needs another valid invite. Invite expiry bounds redemption, not already-joined membership; existing roles cannot be escalated by redeeming another invite.

## Validation commands

```sh
npm run typecheck
node --import tsx --test tests/invite-profile.test.ts
node --import tsx server/access/integration-benchmark.ts 20000
# Mac with installed Chrome; uses two isolated browser contexts and no providers:
PRESENT_E2E_BROWSER_CHANNEL=chrome node --import tsx node_modules/@playwright/test/cli.js test --config tests/access-playwright.config.ts
```

The focused suite exercises real HTTP/native websocket paths, actor/presence binding, reconnect persistence, viewer denial, revocation and late commits, asset isolation/HEAD/range, per-user templates/fresh rooms, signed projects policy, local media JWT claims and an injected provider-removal stub. The benchmark compares warmed cached native reads with/without live authorization, excluding network and providers. Browser coverage is scripted but was **not executed successfully in cloud**: managed browser localhost navigation returns `net::ERR_BLOCKED_BY_CLIENT`, and workspace Playwright Chromium is not installed. The ZIP includes exact results and command evidence; do not count the blocked smoke as passing.
