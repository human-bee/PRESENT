# Demo Runbook (Voice + Linear + Context Feeder)

This is a short, repeatable script for a live demo of the **Voice Agent → UI tools → Linear MCP → Widgets** pipeline.

For a timed “speedrun” version (15 steps / 5 minutes), see `docs/demo-race-track.md`.

## One-time Setup (before demo day)

1. **Supabase migration**
   - Apply `docs/migrations/002_add_context_documents_to_sessions.md` to your Supabase project.
   - This enables the `sessions.context_documents` column used by the ContextFeeder and stewards.

2. **Environment**
   - Ensure `.env.local` contains working keys for:
     - LiveKit (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`)
     - Supabase (`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
     - StewardFAST (`CEREBRAS_API_KEY`) if you want the snappy Linear steward.
   - Recommended for demo reliability: run the realtime agent with `VOICE_AGENT_UPDATE_LOSSY=false`.
   - Optional resilience knobs (defaults shown):
     - `VOICE_AGENT_REPLY_TIMEOUT_MS=8000` (interrupt + retry if a Realtime reply stalls)
     - `VOICE_AGENT_INTERRUPT_TIMEOUT_MS=1500`
     - `VOICE_AGENT_TRANSCRIPTION_READY_TIMEOUT_MS=10000` (buffer early `topic: 'transcription'` messages until the agent session is ready)

3. **Warm the browser once**
   - Open `/canvas`, create a **LinearKanbanBoard**, and paste your Linear API key into the widget once so it’s stored locally.

## Start the stack (demo day)

- Quick start (recommended): `npm run stack:start`
- Or manually (3 terminals):
  - `npm run agent:realtime`
  - `npm run agent:conductor`
  - `npm run dev`

## Live Demo Script (talk track + commands)

1. **Open the room**
   - Go to `/canvas` and join your LiveKit room.

2. **Show the ContextFeeder**
   - Say: “Add a context feeder.”
   - Paste a short roadmap / meeting notes / TODO list into the widget.

3. **Show the Linear Kanban (MCP-powered load)**
   - Say: “Create a kanban board.”
   - Confirm the board shows issues (loaded via Linear MCP).

4. **Turn docs into issues (context → steward → MCP create_issue)**
   - Say: “Turn the context document into Linear issues.”
   - Expected: the board shows a “creating issues” status, then reloads with the new issues visible.

5. **Steer the board (voice → update_component → instruction)**
   - Say: “Move <issue title> to Done.”
   - Expected: the card moves immediately and a pending update appears.

6. **Sync (voice → instruction → GraphQL update)**
   - Say: “Sync to Linear.”
   - Expected: pending updates clear and Linear reflects the new status.

## Quick Troubleshooting

- **Kanban shows “Linear MCP tool unavailable”**
  - Ensure the widget has a Linear API key saved.
  - Ensure `/api/mcp-proxy` is reachable (same-origin) and the browser isn’t blocking SSE.

- **Context documents not showing up in steward behavior**
  - Confirm the Supabase migration has been applied.
  - Confirm `SUPABASE_SERVICE_ROLE_KEY` is set (recommended) so server stewards can read `sessions`.

- **Rate limit**
  - The Linear MCP client throttles requests; keep “create multiple issues” to a small list for live demos.
