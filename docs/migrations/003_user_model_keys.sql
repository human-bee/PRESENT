-- User Model Keys Table (BYOK)
-- Migration: 003_user_model_keys
-- Description: Store encrypted per-user provider API keys for BYOK cost sharing.

create table if not exists public.user_model_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai','anthropic','google','together','cerebras')),
  ciphertext text not null,
  iv text not null,
  last4 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

create index if not exists user_model_keys_user_idx
  on public.user_model_keys(user_id);

alter table public.user_model_keys enable row level security;

-- Service role: full access
create policy "Service role has full access to user_model_keys"
  on public.user_model_keys
  for all
  to service_role
  using (true)
  with check (true);

-- Authenticated users: can manage only their own rows.
create policy "Users can select their own model keys"
  on public.user_model_keys
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own model keys"
  on public.user_model_keys
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own model keys"
  on public.user_model_keys
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own model keys"
  on public.user_model_keys
  for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.user_model_keys is
  'Encrypted per-user provider keys used for BYOK. ciphertext and iv are base64 (AES-GCM). Plaintext keys are never stored.';

