-- Add durable browser executor lease fields for room-scoped tool_call execution.
alter table if exists public.canvas_sessions
  add column if not exists tool_executor_identity text;

alter table if exists public.canvas_sessions
  add column if not exists tool_executor_lease_expires_at timestamptz;

create index if not exists canvas_sessions_tool_executor_lease_idx
  on public.canvas_sessions (room_name, tool_executor_lease_expires_at);

