-- 004_harden_canvas_session_transcripts_rls.sql
-- Lock down transcript rows to canvas owners/members (instead of open-to-all authenticated).
--
-- NOTE: This relies on `canvas_sessions.canvas_id` pointing at `canvases.id` and the
-- `is_canvas_member(user_id, canvas_id)` helper already used by existing RLS policies.

begin;

-- Remove permissive policies introduced by 003.
drop policy if exists canvas_session_transcripts_select_authenticated on public.canvas_session_transcripts;
drop policy if exists canvas_session_transcripts_insert_authenticated on public.canvas_session_transcripts;

alter table public.canvas_session_transcripts enable row level security;

do $$
begin
  -- Read: only members/owners of the backing canvas.
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'canvas_session_transcripts'
      and policyname = 'canvas_session_transcripts_select_member_or_owner'
  ) then
    create policy canvas_session_transcripts_select_member_or_owner
      on public.canvas_session_transcripts
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.canvas_sessions s
          join public.canvases c on c.id = s.canvas_id
          where s.id = canvas_session_transcripts.session_id
            and (
              c.user_id = auth.uid()
              or is_canvas_member(auth.uid(), c.id)
            )
        )
      );
  end if;

  -- Write: only members/owners of the backing canvas.
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'canvas_session_transcripts'
      and policyname = 'canvas_session_transcripts_insert_member_or_owner'
  ) then
    create policy canvas_session_transcripts_insert_member_or_owner
      on public.canvas_session_transcripts
      for insert
      to authenticated
      with check (
        exists (
          select 1
          from public.canvas_sessions s
          join public.canvases c on c.id = s.canvas_id
          where s.id = canvas_session_transcripts.session_id
            and (
              c.user_id = auth.uid()
              or is_canvas_member(auth.uid(), c.id)
            )
        )
      );
  end if;
end $$;

commit;
