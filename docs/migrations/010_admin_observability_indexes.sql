-- 010_admin_observability_indexes.sql
-- Add read-path indexes for admin observability drilldowns.

begin;

create index if not exists agent_trace_events_task_created_idx
  on public.agent_trace_events (task_id, created_at desc);

create index if not exists agent_trace_events_room_status_created_idx
  on public.agent_trace_events (room, status, created_at desc);

create index if not exists canvas_session_transcripts_session_ts_event_idx
  on public.canvas_session_transcripts (session_id, ts desc, event_id);

commit;
