# Agent Observability Admin

## Route

- UI: `/admin/agents`
- APIs:
  - `GET /api/admin/agents/overview`
  - `GET /api/admin/agents/queue`
  - `GET /api/admin/agents/traces`
  - `GET /api/admin/agents/workers`
  - `GET /api/admin/agents/audit`
  - `GET /api/admin/agents/traces/:traceId/context`
  - `POST /api/admin/agents/actions`

## Access Control

- Summary mode can be public if `AGENT_ADMIN_PUBLIC_READ_ACCESS=true` (overview only).
- Default mode requires `AGENT_ADMIN_ALLOWLIST_USER_IDS` (comma-separated Supabase user IDs or emails).
- Optional temporary mode: set `AGENT_ADMIN_AUTHENTICATED_OPEN_ACCESS=true` to allow any authenticated user to read observability.
- Detail routes are controlled by:
  - `AGENT_ADMIN_DETAIL_SIGNED_IN_REQUIRED=true` (default) to block anonymous detail access.
  - `AGENT_ADMIN_DETAIL_GLOBAL_SCOPE=true` (default) for all-room signed-in detail visibility.
  - `AGENT_ADMIN_DETAIL_MASK_DEFAULT=true` (default) for masked payload/transcript UI rendering.
- Safe action writes (`POST /api/admin/agents/actions`) always require allowlist membership, even when authenticated open access is enabled.
- If the allowlist is empty or unset, action APIs return `admin_allowlist_not_configured`.

### Summary vs Detail

- Summary (`/api/admin/agents/overview`) is the lightweight status surface.
- Detail (`/api/admin/agents/queue`, `/api/admin/agents/traces`, `/api/admin/agents/workers`, `/api/admin/agents/audit`, `/api/traces/:traceId`, `/api/admin/agents/traces/:traceId/context`) includes failure diagnostics, worker attribution, and transcript context.

## Safe Actions

- `cancel`: allowed for `queued` and `running`.
- `retry`: allowed for `failed` (creates a new queued row).
- `requeue`: allowed for `running` (resets queue lease and status).

Every action writes an audit row to `agent_ops_audit_log`.

## Worker Health

- Worker processes heartbeat into `agent_worker_heartbeats`.
- UI health labels:
  - `online` <= 10s
  - `degraded` <= 30s
  - `offline` > 30s

## Trace Replay

- Raw trace timeline:
  - `GET /api/traces/:traceId`
  - `GET /api/traces/search`
- Enriched trace context:
  - `GET /api/admin/agents/traces/:traceId/context`
  - Query: `limit` (default 200, max 250), `direction` (`latest|older|newer`), `beforeTs`, `afterTs`
