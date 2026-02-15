-- Agent Ops Audit Log
-- Migration: 007_agent_ops_audit_log
-- Description: Persist operator remediation actions for 90-day auditability.

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

create policy "Service role full access on agent_ops_audit_log"
  on public.agent_ops_audit_log
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.agent_ops_audit_log is
  'Operator action history (cancel/retry/requeue) for compliance and incident forensics.';
