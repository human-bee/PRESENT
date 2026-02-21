-- Fairy orchestration ledger
-- Migration: 012_fairy_orchestration_ledger
-- Description: Persist server-side project/task orchestration events for fairy48 parity paths.

create table if not exists public.fairy_orchestration_ledger (
  id uuid primary key default gen_random_uuid(),
  room text not null,
  session_id text not null,
  trace_id text null,
  request_id text null,
  action_type text not null,
  project_name text null,
  project_mode text null check (project_mode in ('solo', 'duo')),
  project_status text null check (project_status in ('active', 'completed', 'aborted')),
  task_id text null,
  task_title text null,
  assigned_to text null,
  task_status text null check (task_status in ('created', 'started', 'done', 'deleted', 'awaiting', 'delegated')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fairy_orchestration_ledger_room_created_idx
  on public.fairy_orchestration_ledger(room, created_at desc);

create index if not exists fairy_orchestration_ledger_session_created_idx
  on public.fairy_orchestration_ledger(session_id, created_at desc);

create index if not exists fairy_orchestration_ledger_task_idx
  on public.fairy_orchestration_ledger(task_id, created_at desc)
  where task_id is not null;

alter table public.fairy_orchestration_ledger enable row level security;

drop policy if exists "Service role has full access to fairy orchestration ledger"
  on public.fairy_orchestration_ledger;

create policy "Service role has full access to fairy orchestration ledger"
  on public.fairy_orchestration_ledger
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.fairy_orchestration_ledger is
  'Append-only ledger of orchestration actions emitted by fairy48 server execution.';
