# 002 — Add `context_documents` to `sessions`

Apply this SQL to your Supabase Postgres database.

```sql
-- Create sessions table and add context_documents column
-- Migration: 002_add_context_documents_to_sessions
-- Description: Create sessions table (if needed) and add context_documents JSONB column

-- Create the sessions table if it doesn't exist
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  room_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add the context_documents column
alter table public.sessions
  add column if not exists context_documents jsonb default '[]';

-- Create index for efficient queries by room_name
create index if not exists sessions_room_name_idx
  on public.sessions(room_name);

-- Create index for updated_at queries
create index if not exists sessions_updated_at_idx
  on public.sessions(updated_at);

-- Comment on table
comment on table public.sessions is
  'Stores session metadata and context documents for agent sessions.';

-- Comment on column
comment on column public.sessions.context_documents is
  'Array of context documents associated with this session. Used for storing contextual information that agents can reference.';
```
