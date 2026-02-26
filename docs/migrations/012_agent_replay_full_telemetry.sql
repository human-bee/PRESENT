-- Agent replay full telemetry
-- Migration: 012_agent_replay_full_telemetry
-- Description: Hard-cutover schema for full per-model/per-tool replay telemetry.

-- Re-assert provider parity columns for environments that missed migration 011.
alter table public.agent_trace_events
  add column if not exists provider text;

alter table public.agent_trace_events
  add column if not exists model text;

alter table public.agent_trace_events
  add column if not exists provider_source text;

alter table public.agent_trace_events
  add column if not exists provider_path text;

alter table public.agent_trace_events
  add column if not exists provider_request_id text;

-- Re-assert trace correlation column on queue tasks for environments that missed migration 009.
alter table public.agent_tasks
  add column if not exists trace_id text;

create index if not exists agent_tasks_trace_id_created_idx
  on public.agent_tasks(trace_id, created_at desc);

create table if not exists public.agent_io_blobs (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  kind text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  room text,
  trace_id text,
  request_id text,
  intent_id text,
  payload text not null,
  encoding text not null default 'utf8',
  mime_type text not null default 'application/json',
  size_bytes integer,
  sha256 text,
  truncated boolean not null default false,
  metadata jsonb
);

create unique index if not exists agent_io_blobs_event_kind_idx
  on public.agent_io_blobs(event_id, kind);

create index if not exists agent_io_blobs_trace_created_idx
  on public.agent_io_blobs(trace_id, created_at desc);

create index if not exists agent_io_blobs_request_created_idx
  on public.agent_io_blobs(request_id, created_at desc);

create index if not exists agent_io_blobs_room_created_idx
  on public.agent_io_blobs(room, created_at desc);

create index if not exists agent_io_blobs_expires_idx
  on public.agent_io_blobs(expires_at);

create index if not exists agent_io_blobs_created_brin_idx
  on public.agent_io_blobs using brin(created_at);

create table if not exists public.agent_model_io (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  session_id text,
  room text,
  trace_id text,
  request_id text,
  intent_id text,
  task_id uuid,
  source text not null,
  event_type text not null,
  status text,
  provider text,
  model text,
  provider_source text,
  provider_path text,
  provider_request_id text,
  system_prompt text,
  context_priming jsonb,
  input_payload jsonb,
  output_payload jsonb,
  metadata jsonb,
  error text,
  latency_ms integer,
  input_blob_id uuid references public.agent_io_blobs(id) on delete set null,
  output_blob_id uuid references public.agent_io_blobs(id) on delete set null
);

create unique index if not exists agent_model_io_event_idx
  on public.agent_model_io(event_id);

create index if not exists agent_model_io_trace_created_idx
  on public.agent_model_io(trace_id, created_at desc);

create index if not exists agent_model_io_request_created_idx
  on public.agent_model_io(request_id, created_at desc);

create index if not exists agent_model_io_room_status_created_idx
  on public.agent_model_io(room, status, created_at desc);

create index if not exists agent_model_io_provider_model_created_idx
  on public.agent_model_io(provider, model, created_at desc);

create index if not exists agent_model_io_expires_idx
  on public.agent_model_io(expires_at);

create index if not exists agent_model_io_created_brin_idx
  on public.agent_model_io using brin(created_at);

create table if not exists public.agent_tool_io (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  sequence integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  session_id text,
  room text,
  trace_id text,
  request_id text,
  intent_id text,
  task_id uuid,
  source text not null,
  event_type text not null,
  status text,
  tool_name text not null,
  tool_call_id text,
  provider text,
  model text,
  provider_source text,
  provider_path text,
  provider_request_id text,
  input_payload jsonb,
  output_payload jsonb,
  metadata jsonb,
  error text,
  latency_ms integer,
  input_blob_id uuid references public.agent_io_blobs(id) on delete set null,
  output_blob_id uuid references public.agent_io_blobs(id) on delete set null
);

create unique index if not exists agent_tool_io_event_idx
  on public.agent_tool_io(event_id);

create index if not exists agent_tool_io_trace_created_idx
  on public.agent_tool_io(trace_id, created_at desc);

create index if not exists agent_tool_io_request_created_idx
  on public.agent_tool_io(request_id, created_at desc);

create index if not exists agent_tool_io_room_status_created_idx
  on public.agent_tool_io(room, status, created_at desc);

create index if not exists agent_tool_io_name_status_created_idx
  on public.agent_tool_io(tool_name, status, created_at desc);

create index if not exists agent_tool_io_expires_idx
  on public.agent_tool_io(expires_at);

create index if not exists agent_tool_io_created_brin_idx
  on public.agent_tool_io using brin(created_at);

alter table public.agent_io_blobs enable row level security;
alter table public.agent_model_io enable row level security;
alter table public.agent_tool_io enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_io_blobs'
      and policyname = 'Service role full access on agent_io_blobs'
  ) then
    create policy "Service role full access on agent_io_blobs"
      on public.agent_io_blobs
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_model_io'
      and policyname = 'Service role full access on agent_model_io'
  ) then
    create policy "Service role full access on agent_model_io"
      on public.agent_model_io
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_tool_io'
      and policyname = 'Service role full access on agent_tool_io'
  ) then
    create policy "Service role full access on agent_tool_io"
      on public.agent_tool_io
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

comment on table public.agent_io_blobs is
  'Raw replay payload blobs (full serialized model/tool bodies) retained for forensic replay.';

comment on table public.agent_model_io is
  'Per-model turn ledger for replay (system/context/input/output with correlation ids).';

comment on table public.agent_tool_io is
  'Per-tool call/result/error ledger for replay with collapsible input/output payloads.';
