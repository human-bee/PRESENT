# Agent Observability Admin

## Route

- UI: `/admin/agents`
- APIs:
  - `GET /api/admin/agents/overview`
  - `GET /api/admin/agents/queue`
  - `GET /api/admin/agents/traces`
  - `GET /api/admin/agents/workers`
  - `GET /api/admin/agents/audit`
  - `POST /api/admin/agents/actions`

## Access Control

- Requires authenticated user.
- Default mode requires `AGENT_ADMIN_ALLOWLIST_USER_IDS` (comma-separated Supabase user IDs or emails).
- Optional temporary mode: set `AGENT_ADMIN_AUTHENTICATED_OPEN_ACCESS=true` to allow any authenticated user to read admin observability endpoints.
- Always set `AGENT_ADMIN_AUTHENTICATED_OPEN_ACCESS=false` after debugging windows close.
- Safe action writes (`POST /api/admin/agents/actions`) always require allowlist membership, even when authenticated open access is enabled.
- If the allowlist is empty or unset, action APIs return `admin_allowlist_not_configured`.

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
