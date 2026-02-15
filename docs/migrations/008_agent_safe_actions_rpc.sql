-- Agent Safe Actions RPC
-- Migration: 008_agent_safe_actions_rpc
-- Description: Optional SQL RPC helpers for admin-safe action workflows.

-- Note:
-- Current implementation executes safe actions from the server API layer.
-- This SQL is intentionally minimal and can be adopted later for DB-native workflows.

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
