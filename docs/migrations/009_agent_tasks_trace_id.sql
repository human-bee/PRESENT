-- Agent task trace-id correlation
-- Migration: 009_agent_tasks_trace_id
-- Description: Add trace_id to agent_tasks for direct task->trace joins in observability APIs.

alter table if exists public.agent_tasks
  add column if not exists trace_id text;

-- Backfill from existing task params (supports both camel/snake case and nested metadata).
update public.agent_tasks
set trace_id = coalesce(
  nullif(btrim(params ->> 'traceId'), ''),
  nullif(btrim(params ->> 'trace_id'), ''),
  nullif(btrim(params -> 'metadata' ->> 'traceId'), ''),
  nullif(btrim(params -> 'metadata' ->> 'trace_id'), '')
)
where trace_id is null;

create index if not exists agent_tasks_trace_id_idx
  on public.agent_tasks(trace_id, created_at desc);

comment on column public.agent_tasks.trace_id is
  'Optional correlation id linking queue tasks directly to agent_trace_events.';

