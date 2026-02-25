-- Model control plane
-- Migration: 013_model_control_plane
-- Description: Adds runtime model/knob profiles plus shared keyring + unlock session controls.

create table if not exists public.agent_model_control_profiles (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('global', 'room', 'user', 'task')),
  scope_id text not null,
  task_prefix text null,
  enabled boolean not null default true,
  priority int not null default 100,
  config jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_model_control_profiles_scope_idx
  on public.agent_model_control_profiles(scope_type, scope_id, priority desc, updated_at desc);

create index if not exists agent_model_control_profiles_task_prefix_idx
  on public.agent_model_control_profiles(task_prefix)
  where task_prefix is not null;

create unique index if not exists agent_model_control_profiles_scope_unique
  on public.agent_model_control_profiles(scope_type, scope_id, coalesce(task_prefix, ''));

alter table public.agent_model_control_profiles enable row level security;

drop policy if exists "Service role full access on agent_model_control_profiles"
  on public.agent_model_control_profiles;

create policy "Service role full access on agent_model_control_profiles"
  on public.agent_model_control_profiles
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.agent_model_control_profiles is
  'Versioned non-secret model/knob control-plane profiles by scope.';

create table if not exists public.admin_model_shared_keys (
  provider text primary key check (provider in ('openai', 'anthropic', 'google', 'together', 'cerebras')),
  ciphertext text not null,
  iv text not null,
  last4 text not null,
  enabled boolean not null default true,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_model_shared_keys enable row level security;

drop policy if exists "Service role full access on admin_model_shared_keys"
  on public.admin_model_shared_keys;

create policy "Service role full access on admin_model_shared_keys"
  on public.admin_model_shared_keys
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.admin_model_shared_keys is
  'Encrypted admin-provided provider keys used as fallback after BYOK.';

create table if not exists public.admin_model_keyring_policy (
  id int primary key check (id = 1),
  password_hash text null,
  password_salt text null,
  password_required boolean not null default false,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.admin_model_keyring_policy (id, password_hash, password_salt, password_required)
values (1, null, null, false)
on conflict (id) do nothing;

alter table public.admin_model_keyring_policy enable row level security;

drop policy if exists "Service role full access on admin_model_keyring_policy"
  on public.admin_model_keyring_policy;

create policy "Service role full access on admin_model_keyring_policy"
  on public.admin_model_keyring_policy
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.admin_model_keyring_policy is
  'Global optional unlock password policy for admin shared keyring.';

create table if not exists public.admin_model_unlock_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_scope text null,
  session_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  last_used_at timestamptz not null default now(),
  created_by_ip inet null,
  attempt_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_model_unlock_sessions_user_idx
  on public.admin_model_unlock_sessions(user_id, expires_at desc);

create index if not exists admin_model_unlock_sessions_room_idx
  on public.admin_model_unlock_sessions(room_scope, expires_at desc)
  where room_scope is not null;

create unique index if not exists admin_model_unlock_sessions_token_hash_unique
  on public.admin_model_unlock_sessions(session_token_hash);

alter table public.admin_model_unlock_sessions enable row level security;

drop policy if exists "Service role full access on admin_model_unlock_sessions"
  on public.admin_model_unlock_sessions;

create policy "Service role full access on admin_model_unlock_sessions"
  on public.admin_model_unlock_sessions
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.admin_model_unlock_sessions is
  'Short-lived unlock sessions that allow eligible users to consume admin shared keys.';
