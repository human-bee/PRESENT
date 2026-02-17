-- Agent Observability Recovery
-- Migration: 009_agent_observability_recovery
-- Description: Ensure admin observability tables exist in every environment and backfill trace rows from agent_tasks.

create extension if not exists pgcrypto;

create table if not exists public.agent_trace_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  trace_id text,
  request_id text,
  intent_id text,
  room text,
  task_id uuid,
  attempt int not null default 0,
  task text,
  component text,
  stage text not null,
  status text,
  latency_ms int,
  payload jsonb,
  sampled boolean not null default true
);

-- Keep stage/status as text even if a prior rollout created enum-backed columns.
alter table public.agent_trace_events
  alter column stage type text using stage::text;
alter table public.agent_trace_events
  alter column status type text using status::text;

create index if not exists agent_trace_events_trace_idx on public.agent_trace_events(trace_id, created_at desc);
create index if not exists agent_trace_events_request_idx on public.agent_trace_events(request_id, created_at desc);
create index if not exists agent_trace_events_room_idx on public.agent_trace_events(room, created_at desc);
create index if not exists agent_trace_events_stage_idx on public.agent_trace_events(stage, created_at desc);

alter table public.agent_trace_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_trace_events'
      and policyname = 'Service role full access on agent_trace_events'
  ) then
    create policy "Service role full access on agent_trace_events"
      on public.agent_trace_events
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end
$$;

comment on table public.agent_trace_events is
  'Server-side canonical trace timeline for queue claim/execute/ack lifecycle.';

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

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_worker_heartbeats'
      and policyname = 'Service role full access on agent_worker_heartbeats'
  ) then
    create policy "Service role full access on agent_worker_heartbeats"
      on public.agent_worker_heartbeats
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end
$$;

comment on table public.agent_worker_heartbeats is
  'Latest heartbeat per worker process for admin health dashboards.';

create table if not exists public.agent_ops_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_task_id uuid,
  target_trace_id text,
  reason text not null,
  before_status text,
  after_status text,
  result jsonb
);

create index if not exists agent_ops_audit_log_created_idx on public.agent_ops_audit_log(created_at desc);
create index if not exists agent_ops_audit_log_actor_idx on public.agent_ops_audit_log(actor_user_id, created_at desc);
create index if not exists agent_ops_audit_log_task_idx on public.agent_ops_audit_log(target_task_id, created_at desc);

alter table public.agent_ops_audit_log enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_ops_audit_log'
      and policyname = 'Service role full access on agent_ops_audit_log'
  ) then
    create policy "Service role full access on agent_ops_audit_log"
      on public.agent_ops_audit_log
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end
$$;

comment on table public.agent_ops_audit_log is
  'Operator action history (cancel/retry/requeue) for compliance and incident forensics.';

create or replace function public.agent_mark_task_requeued(
  p_task_id uuid
)
returns void
language plpgsql
security definer
as $$
begin
  update public.agent_tasks
  set status = 'queued',
      lease_token = null,
      lease_expires_at = null,
      run_at = now(),
      updated_at = now()
  where id = p_task_id;
end;
$$;

revoke all on function public.agent_mark_task_requeued(uuid) from public;
grant execute on function public.agent_mark_task_requeued(uuid) to service_role;

insert into public.agent_trace_events (
  id,
  created_at,
  trace_id,
  request_id,
  intent_id,
  room,
  task_id,
  attempt,
  task,
  component,
  stage,
  status,
  latency_ms,
  payload,
  sampled
)
select
  gen_random_uuid(),
  coalesce(t.updated_at, t.created_at, now()),
  coalesce(t.params->>'traceId', t.params->>'trace_id', t.params->'metadata'->>'traceId', t.params->'metadata'->>'trace_id'),
  coalesce(t.request_id, t.params->>'requestId', t.params->>'request_id', t.params->'metadata'->>'requestId', t.params->'metadata'->>'request_id'),
  coalesce(t.params->>'intentId', t.params->>'intent_id', t.params->'metadata'->>'intentId', t.params->'metadata'->>'intent_id'),
  t.room,
  t.id,
  greatest(coalesce(t.attempt, 0), 0),
  t.task,
  null,
  case
    when t.status = 'queued' then 'queued'
    when t.status = 'running' then 'executing'
    when t.status = 'failed' then 'failed'
    when t.status = 'succeeded' then 'completed'
    when t.status = 'canceled' then 'canceled'
    else coalesce(t.status::text, 'queued')
  end,
  t.status::text,
  null,
  jsonb_build_object('source', 'agent_tasks_backfill', 'error', t.error),
  true
from public.agent_tasks t
where not exists (
  select 1
  from public.agent_trace_events e
  where e.task_id = t.id
    and e.status is not distinct from t.status::text
    and e.created_at = coalesce(t.updated_at, t.created_at, now())
);

