-- Agent trace provider parity
-- Migration: 011_agent_trace_provider_parity
-- Description: Add first-class provider metadata columns for admin observability parity.

alter table public.agent_trace_events
  add column if not exists provider text;

alter table public.agent_trace_events
  add column if not exists model text;

alter table public.agent_trace_events
  add column if not exists provider_source text;

alter table public.agent_trace_events
  add column if not exists provider_path text;

alter table public.agent_trace_events
  add column if not exists provider_request_id text;

create index if not exists agent_trace_events_provider_created_idx
  on public.agent_trace_events(provider, created_at desc);

create index if not exists agent_trace_events_provider_status_created_idx
  on public.agent_trace_events(provider, status, created_at desc);

create index if not exists agent_trace_events_task_provider_created_idx
  on public.agent_trace_events(task_id, provider, created_at desc);

comment on column public.agent_trace_events.provider is
  'Normalized provider id for admin observability (openai|anthropic|google|cerebras|together|debug|unknown).';

comment on column public.agent_trace_events.model is
  'Canonical model identifier associated with this trace row.';

comment on column public.agent_trace_events.provider_source is
  'Provider attribution source (explicit|model_inferred|runtime_selected|task_params|payload|unknown).';

comment on column public.agent_trace_events.provider_path is
  'Execution path (primary|fallback|fast|slow|shadow|teacher|unknown).';

comment on column public.agent_trace_events.provider_request_id is
  'Optional provider-side request identifier when available.';
