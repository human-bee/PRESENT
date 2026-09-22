# Room access: milestone 3 integration handoff

Baseline: `2cd569fca3c4363ca2dfa37c9327faa59d5f5d8f`, branch `codex/present-cloud-base-20260921`. This contribution adds only the access lane. **It is not mounted and does not make the current server safe to expose remotely.** No bind address, settings, main application, room persistence, media wiring, or existing routes are changed.

## Configuration and developer loop

`configuredAccess()` from `server/access/index.ts` returns undefined when `PRESENT_ACCESS_MODE` is absent or `local`. Keep today's loopback-only developer behavior in that case. Explicit `invite` mode requires all of:

- `PRESENT_ACCESS_SECRET`: operator-supplied high-entropy secret, at least 32 bytes. No generated deployment fallback; no committed credential. Keep stable across restarts. Rotation invalidates every session.
- `PRESENT_ACCESS_ORIGIN`: exact canonical HTTPS origin (no path/trailing slash). Explicit `http://127.0.0.1:PORT` is supported for local integration testing.
- `PRESENT_ACCESS_DIRECTORY`: private durable directory outside public/static serving roots, on a filesystem supporting atomic rename and directory fsync.

This module does not read forwarded headers, listen on a network address, enable CORS, or relax the existing sandbox policy. Remote transport/proxy configuration is coordinator-owned. Preserve exact Host/Origin checking at HTTP entry and every websocket upgrade listener, and retain separation of the MCP sandbox origin. Never treat an arbitrary forwarded host as trusted. Public hosting remains blocked until every access path below is wired. Rate-limit session creation and invite attempts at the HTTP edge before alpha exposure; these endpoints are unauthenticated capability entry points. Core state has fixed limits of 1,000 sessions/rooms and 1,000 members/invites per room to bound disk growth; this is not a substitute for edge rate limiting.

## Exact HTTP mounting

Initialize once after dotenv configuration:

```ts
import { configuredAccess, assertAccessOrigin, authorizeRequest, AccessError } from './access';
const alpha = configuredAccess();
```

In the coordinator's request handler, after the existing sandbox isolation but before dispatch:

```ts
if (alpha) {
  assertAccessOrigin(req, alpha.origin, !['GET', 'HEAD'].includes(req.method ?? ''));
  if (await alpha.handleRequest(req, res)) return;
}
```

`assertAccessOrigin` augments the explicit invite-mode host policy; simply placing this behind today's unconditional loopback Host rejection will intentionally still reject remote traffic. Preserve the current local branch unchanged. The coordinator must explicitly select the canonical invite-mode transport policy; this contribution does not choose one. Errors from protected routes should map `AccessError.status/message` in the coordinator's error handler, without exposing internal exceptions. Call `alpha?.access.close()` on orderly shutdown.

| Method | Path | Input/result |
| --- | --- | --- |
| POST | `/api/access/session` | Server chooses identity; HttpOnly, SameSite=Strict cookie, Secure over HTTPS. Existing valid cookie reuses identity. |
| DELETE | `/api/access/session` | Revoke session, clear cookie. An expired cookie can also be cleared. |
| POST | `/api/access/rooms` | Authenticated session creates server-selected room ID and owner grant. No arbitrary ID claiming. |
| POST | `/api/access/join` | `{token}` → membership grant, role chosen from persisted invite only. |
| GET | `/api/access/rooms/:roomId` | Own membership grant, including role and session expiry. |
| POST | `/api/access/rooms/:roomId/invites` | Owner only: `{role: 'editor'|'viewer', ttlMs, maxUses}` → invite ID/token. |
| DELETE | `/api/access/rooms/:roomId/invites/:inviteId` | Owner revokes invite and every membership derived from it. |
| DELETE | `/api/access/rooms/:roomId/members/:userId` | Owner revokes a non-owner member. |
| POST | `/api/access/rooms/:roomId/leave` | Non-owner permanently gives up this identity's membership. |

All mutation requests require the exact Origin header, including cookie/session endpoints. JSON request bodies are limited to 4 KiB and validated strictly. Session tokens are never accepted in request bodies, URL parameters, or actor fields. Invite tokens are bearer capabilities, SHA-256 hashed at rest, bounded to 1–10 uses and 1 second–7 days. UI defaults: one use, 24 hours. Expiry limits redemption; joined membership continues until revoked, left, or session expiry. A viewer redeeming an editor invite remains a viewer; invitations do not alter existing roles.

## Authorization hooks — deny before room-store access

```ts
const grant = authorizeRequest(alpha.access, req, roomId, 'write');
// Server identity replaces every client-supplied actor/user ID.
applyOperation(roomId, input.operation, grant.userId, options);
```

For code that awaits work, capture the cookie token using `sessionToken(req)`, construct `authorizationPath(access, token, roomId, permission)`, and call the resulting function immediately before each sensitive read/commit. Do not cache a grant as continuing authorization. RoomStore creates missing rooms lazily: never call it before access authorization. Creating an access room reserves an ID; native state may initialize lazily afterward. Existing baseline rooms have no access records and are denied in invite mode; this is intentional. No auto-claim migration from room-ID knowledge.

| Surface | Required permission / integration |
| --- | --- |
| Room snapshot, document, subscriptions, read canvas | `read` before loading, reading, or streaming the room |
| Operations, canvas mutations, scene/playbook changes | `write` before commit; server-issued actor |
| Agent/provider/work/MCP tools, costly remote execution | `tools` before starting and again before each eventual mutation; bind scope to authorized room server-side |
| Asset upload | `asset:write`; persist asset → authorized room association before returning URL |
| Asset GET/HEAD/range | `asset:read` on actual persisted asset room association before opening file; use private/no-store caching |
| Media joins/tokens/recordings | `read` for receive, `write` for publish; mint bounded provider grants using authenticated identity; coordinator owns wiring |
| Invite/member revocation | `invite` / `revoke`, owner only |

**Assets currently have global `/api/assets/:name` URLs and no room association.** A room query parameter alone is insufficient: an attacker with access to their own room could substitute another asset name. Coordinator must add a durable association or room-specific namespace and enforce it on upload and every read. Do not expose the old global asset handler in invite mode before that exists. Inventory non-room endpoints (benchmarks, embeddings/proxies, work, scenes, MCP, providers) explicitly; unknown/unscoped APIs must default-deny in invite mode. The access handler only owns `/api/access/*`; it is not a catch-all firewall.

## Websocket integration (server/room-socket.ts, coordinator)

Before `getTldrawRoom` and `handleUpgrade`, require `assertAccessOrigin(request, alpha.origin, true)` and `authorizeRequest(access, request, roomId, 'read')`. Session IDs provided by tldraw are transport IDs, never auth identities. Namespace them with the authenticated `grant.userId` before peer lookup so a guest cannot replace another participant's connection.

```ts
const token = sessionToken(request);
const check = authorizationPath(access, token, roomId, 'read');
const grant = check();
const nativeSessionId = `${grant.userId}:${clientSessionId}`;
room.handleSocketConnect({
  sessionId: nativeSessionId,
  isReadonly: grant.role === 'viewer',
  objectAccess: grant.role === 'viewer' ? 'read' : 'write',
  socket: guardedSocket,
});
const unwatch = watchAuthorization(access, token, roomId,
  () => connection.close(1008, 'Room access ended.'));
connection.once('close', unwatch);
```

Use `check()` before each inbound frame is passed to `handleSocketMessage`, and before **each outbound** `guardedSocket.send`; close on failure. Native readonly + objectAccess enforce viewer permissions while allowing legitimate presence/protocol traffic. Do not allow client claims/presence metadata to authorize tools. `watchAuthorization` closes idle connections on persisted revocation or expiry; its timer rechecks at most every minute and at the expiry deadline. Unsubscribe on connection/stream close. Streams and pending agent work need the same cancellation/invalidation pattern. Provider media revocation must additionally remove participants/revoke provider grants; this hook alone cannot revoke a previously minted external token.

## Compact UI mounting (src/app.tsx, coordinator)

Exports in `src/access/room-access.tsx`: `JoinRoom`, `InviteRoom`, `roomAccessClient`, `takeRoomInvite`. Before the app's old `getRoomId()` runs, capture the invitation once at application bootstrap:

```ts
const initialInvite = takeRoomInvite(); // strips #invite from history, before analytics
```

Render `<JoinRoom initialInvite={initialInvite} onJoined={grant => { history.replaceState({}, '', `/r/${grant.roomId}`); /* store grant, then mount room */ }} />` when not admitted. On `/r/:roomId`, fetch `roomAccessClient.get(roomId)` and mount the existing room only after success. Failure displays the join screen, never creates access for that URL. On successful membership, use `grant.userId` for actor/presence identity and mount `<InviteRoom key={grant.roomId} grant={grant} />` beside room controls. Owner-only UI is convenience; server checks are authoritative. A non-owner Leave button calls `roomAccessClient.leave(grant.roomId)`, tears down sync/media, and returns to the join screen. Display server errors and session expiry; don't silently replace an invalid owner identity.

Invite links use `/#invite=...` so redemption secrets never enter HTTP request URLs or Referer headers. The user explicitly clicks Join; GET/prefetch never consumes an invite. Tokens are not put in localStorage. The UI allows selecting/copying a new link and revoking it during the mounted session. For later revocation, retain the returned non-secret invite ID in coordinator-owned room UI state, or revoke a member by the server-issued user ID; there is no admin/account system or invite-list screen in this lane.

## Persistence, lifecycle and intentional alpha limits

Synchronous copy-on-write mutations serialize redemption counts within one Node process. Write private temporary file → file fsync → atomic rename → directory fsync → publish memory → notify listeners. A failed pre-rename write leaves the old state; an ambiguous post-rename durability failure disables the store and notifies active access watchers. Corrupt records fail startup; never silently recreate an empty store. The exclusive `access.lock` blocks a second writer. **Single process, local durable filesystem only**; not cluster/shared-NFS storage. After an unclean process exit, verify no writer is alive and remove only the stale lock before restart. Do not remove the access JSON or automate lock stealing. Back up the access directory with room data.

Sessions last seven days by default (constructor supports up to 30). This minimal alpha has no account recovery or renewal: clearing cookies, expiry, or secret rotation loses the owner's ability to manage that room. Plan the two-person test within this window and retain the browser session; recovery/ownership transfer is a follow-up, not an insecure room-ID claim endpoint. Owners cannot leave or be revoked via member APIs. Leaving or revoking membership creates a tombstone: another invite cannot restore that same identity. A newly created anonymous session is a different identity and may redeem a different valid invitation; this system is capability access, not person-level banning. Do not distribute another invite to someone whose access should remain revoked.

## Local validation

```sh
npm ci --ignore-scripts
node --import tsx --test tests/room-access.test.ts
npm run typecheck
node --import tsx server/access/benchmark.ts 100000
```

The focused contract suite exercises real local HTTP handlers and cookie/Origin behavior plus role checks, single-use redemption, privilege escalation attempts, tampering, expiry, live watcher invalidation, durable replay denial, member/session revocation, exclusive writer and failed persistence. Benchmark excludes network and writes: warmed HMAC/session/membership/permission checks, random ephemeral test secret, temporary directory removed afterward. No live provider tests, deployment, or external messages are needed.

Validation on the cloud baseline: all 3 focused contract tests passed; `npm run typecheck` passed. The local authorization benchmark measured 100,000 checks in 4,753 ms (47.53 µs/check, about 21,038 checks/s); environment-specific, not an end-to-end throughput claim. The direct Node loader avoids the tsx CLI IPC socket denied by this environment.
