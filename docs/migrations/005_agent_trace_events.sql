-- Agent Trace Events
-- Migration: 005_agent_trace_events
-- Description: Canonical end-to-end trace ledger across queue, swarm, and ack lifecycle.

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

create index if not exists agent_trace_events_trace_idx on public.agent_trace_events(trace_id, created_at desc);
create index if not exists agent_trace_events_request_idx on public.agent_trace_events(request_id, created_at desc);
create index if not exists agent_trace_events_room_idx on public.agent_trace_events(room, created_at desc);
create index if not exists agent_trace_events_stage_idx on public.agent_trace_events(stage, created_at desc);

alter table public.agent_trace_events enable row level security;

create policy "Service role full access on agent_trace_events"
  on public.agent_trace_events
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.agent_trace_events is
  'Server-side canonical trace timeline for queue claim/execute/ack lifecycle.';
