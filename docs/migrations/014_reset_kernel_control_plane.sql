-- Reset-era control plane entities for the Codex-native workspace runtime.
-- Migration: 014_reset_kernel_control_plane

create table if not exists public.workspace_sessions (
  id text primary key,
  workspace_path text not null,
  branch text not null,
  title text not null,
  state text not null default 'active',
  owner_user_id text,
  active_executor_session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.executor_sessions (
  id text primary key,
  workspace_session_id text not null references public.workspace_sessions(id) on delete cascade,
  identity text not null,
  kind text not null,
  state text not null default 'ready',
  auth_mode text not null,
  codex_base_url text,
  capabilities jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_heartbeat_at timestamptz
);

create unique index if not exists executor_sessions_workspace_identity_idx
  on public.executor_sessions(workspace_session_id, identity);

create table if not exists public.executor_leases (
  id text primary key,
  workspace_session_id text not null references public.workspace_sessions(id) on delete cascade,
  identity text not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists executor_leases_workspace_idx
  on public.executor_leases(workspace_session_id);

create table if not exists public.task_runs (
  id text primary key,
  workspace_session_id text not null references public.workspace_sessions(id) on delete cascade,
  trace_id text not null,
  task_type text not null,
  status text not null,
  request_id text,
  dedupe_key text,
  summary text not null,
  result jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists task_runs_workspace_updated_idx
  on public.task_runs(workspace_session_id, updated_at desc);

create index if not exists task_runs_trace_idx
  on public.task_runs(trace_id, created_at desc);

create table if not exists public.artifacts (
  id text primary key,
  workspace_session_id text not null references public.workspace_sessions(id) on delete cascade,
  trace_id text,
  kind text not null,
  title text not null,
  mime_type text not null,
  content text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artifacts_workspace_updated_idx
  on public.artifacts(workspace_session_id, updated_at desc);

create table if not exists public.approval_requests (
  id text primary key,
  workspace_session_id text not null references public.workspace_sessions(id) on delete cascade,
  trace_id text not null,
  task_run_id text references public.task_runs(id) on delete set null,
  kind text not null,
  state text not null default 'pending',
  title text not null,
  detail text not null,
  requested_by text not null,
  resolved_by text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists approval_requests_workspace_updated_idx
  on public.approval_requests(workspace_session_id, updated_at desc);

create table if not exists public.presence_members (
  id text primary key,
  workspace_session_id text not null references public.workspace_sessions(id) on delete cascade,
  identity text not null,
  display_name text not null,
  state text not null,
  media jsonb not null default '{"audio":false,"video":false,"screen":false}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists presence_members_workspace_identity_idx
  on public.presence_members(workspace_session_id, identity);

create table if not exists public.model_profiles (
  id text primary key,
  role text not null,
  provider text not null,
  model text not null,
  label text not null,
  source text not null,
  is_default boolean not null default false,
  latency_class text not null,
  supports jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reset_trace_events (
  id text primary key,
  trace_id text not null,
  workspace_session_id text not null references public.workspace_sessions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  emitted_at timestamptz not null default now()
);

create index if not exists reset_trace_events_trace_idx
  on public.reset_trace_events(trace_id, emitted_at desc);
