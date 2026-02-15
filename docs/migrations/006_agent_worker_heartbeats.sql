-- Agent Worker Heartbeats
-- Migration: 006_agent_worker_heartbeats
-- Description: Track worker liveness and active load for admin observability.

create table if not exists public.agent_worker_heartbeats (
  worker_id text primary key,
  updated_at timestamptz not null default now(),
  host text,
  pid text,
  version text,
  active_tasks int not null default 0,
  queue_lag_ms int not null default 0
);

create index if not exists agent_worker_heartbeats_updated_idx
  on public.agent_worker_heartbeats(updated_at desc);

alter table public.agent_worker_heartbeats enable row level security;

create policy "Service role full access on agent_worker_heartbeats"
  on public.agent_worker_heartbeats
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.agent_worker_heartbeats is
  'Latest heartbeat per worker process for admin health dashboards.';
