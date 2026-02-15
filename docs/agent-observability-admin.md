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
- Requires `AGENT_ADMIN_ALLOWLIST_USER_IDS` (comma-separated Supabase user IDs).
- If the allowlist is empty or unset, APIs return `admin_allowlist_not_configured`.

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
