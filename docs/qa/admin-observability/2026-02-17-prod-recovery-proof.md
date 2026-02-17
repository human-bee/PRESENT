# Admin Observability Prod Recovery Proof (2026-02-17)

## Deployment

- Production deployment: `https://present-1z3stbpfi-human-bees-projects.vercel.app`
- Aliases attached:
  - `https://present.best`
  - `https://app.present.best`
  - `https://www.present.best`

## Env Fixes Applied (Production)

- `AGENT_ADMIN_AUTHENTICATED_OPEN_ACCESS=true`
- `AGENT_ADMIN_PUBLIC_READ_ACCESS=true`
- `AGENT_TRACE_LEDGER_ENABLED=true`
- `AGENT_TRACE_SAMPLE_RATE=1`

## Database Recovery Applied (Production Supabase)

Recovered via Supabase Management API SQL (`/v1/projects/zrrdcztzztihbjewlqde/database/query`):

- Created/ensured:
  - `public.agent_trace_events`
  - `public.agent_worker_heartbeats`
  - `public.agent_ops_audit_log`
  - `public.agent_mark_task_requeued(uuid)` RPC
- Enforced trace column types:
  - `agent_trace_events.stage` => `text`
  - `agent_trace_events.status` => `text`
- Backfilled trace rows from `agent_tasks`.

## Verification Results

Post-recovery SQL checks:

- `agent_trace_events`: `1004` rows
- `agent_worker_heartbeats`: `1` row
- `agent_ops_audit_log`: `0` rows
- Room `canvas-b25104a8-da31-4bc3-8a88-4d2aa907618a`:
  - `agent_tasks`: `11` rows
  - `agent_trace_events`: `11` rows

REST checks with prod service-role client after recovery:

- `agent_tasks` query: success
- `agent_trace_events` query: success
- `agent_worker_heartbeats` query: success
- `agent_ops_audit_log` query: success

Public unauthenticated API checks after enabling `AGENT_ADMIN_PUBLIC_READ_ACCESS`:

- `GET https://present.best/api/admin/agents/overview` => `200`, payload includes:
  - `"actorUserId":"anonymous"`
  - `"actorAccessMode":"open_access"`
- `GET https://present.best/api/admin/agents/traces?limit=10&room=canvas-b25104a8-da31-4bc3-8a88-4d2aa907618a` => `200`, payload includes trace rows for that room.

## UI Screenshots

- `/Users/bsteinher/.codex/worktrees/96f3/PRESENT/docs/qa/admin-observability/2026-02-17-prod-admin-after-load.png`
- `/Users/bsteinher/.codex/worktrees/96f3/PRESENT/docs/qa/admin-observability/2026-02-17-prod-admin-room-filter.png`
- `/Users/bsteinher/.codex/worktrees/96f3/PRESENT/docs/qa/admin-observability/2026-02-17-prod-admin-page.png`
- `/Users/bsteinher/.codex/worktrees/96f3/PRESENT/docs/qa/admin-observability/2026-02-17-prod-admin-public-read.png`
- `/Users/bsteinher/.codex/worktrees/96f3/PRESENT/docs/qa/admin-observability/2026-02-17-prod-admin-public-read-room-filter.png`

These screenshots show the page rendering without server crashes and with readable UI styling.
