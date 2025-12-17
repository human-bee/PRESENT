# Demo Race Track (15 steps / 5 minutes)

Goal: a repeatable “lap” that stress-tests the **Voice Agent → Tool calls → Widgets → Linear MCP/GraphQL → Stewards** pipeline.

## Starting Line (consistent for every lap)

- Stack is running: `npm run stack:start` (or `agent:realtime`, `agent:conductor`, `dev`)
- Recommended for demo reliability: `VOICE_AGENT_UPDATE_LOSSY=false` (realtime agent publishes `update_component` reliably)
- You are on `/canvas` in your demo room
- LinearKanbanBoard has a valid Linear API key saved locally
- Supabase migration applied: `docs/migrations/002_add_context_documents_to_sessions.md`

Linear (one-time prep, recommended so laps are deterministic):
- Ensure your Linear workspace has a **demo team** you’re comfortable writing issues into.
- Create two seed issues in that team:
  - `Demo Task A`
  - `Demo Task B`
  - These are used in Steps 8–10 for fast voice steering + sync.
- After creation, note their **identifiers** (e.g. `PRE-161`, `PRE-162`) and use identifiers in voice commands for zero ambiguity.

Optional (recommended for ghost racing):
- Set `NEXT_PUBLIC_TOOL_DISPATCHER_METRICS=true` to log “tSend/tArrive/tPaint” in the browser console.

## Timing Rules

- Start the stopwatch when you speak Step 1.
- A step “counts” when the expected visible UI state is reached.
- Checkpoint at **2:00**: Steps 1–10 complete.
- Finish at **5:00**: Steps 1–15 complete.

## Lap Sheet (fill in per run)

| # | Target split | Actual split | Pass/Fail | Notes |
|---:|:-----------:|:------------:|:---------:|:------|
| 1 | 0:10 |  |  |  |
| 2 | 0:20 |  |  |  |
| 3 | 0:35 |  |  |  |
| 4 | 0:45 |  |  |  |
| 5 | 1:00 |  |  |  |
| 6 | 1:15 |  |  |  |
| 7 | 1:30 |  |  |  |
| 8 | 1:45 |  |  |  |
| 9 | 1:55 |  |  |  |
| 10 | 2:00 |  |  |  |
| 11 | 2:20 |  |  |  |
| 12 | 3:10 |  |  |  |
| 13 | 3:40 |  |  |  |
| 14 | 4:10 |  |  |  |
| 15 | 5:00 |  |  |  |

## Lap: 10 fast steps (0:00–2:00)

1–2) Combo utterance (counts as Steps 1 and 2 once both widgets appear):
   - Say: “Create a kanban board and a context feeder.”
   - Expect: LinearKanbanBoard appears (skeleton is fine) + ContextFeeder appears.

3) “Create a timer for five minutes.”
   - Expect: RetroTimerEnhanced appears.

4) “Start the timer.”
   - Expect: timer shows running state.

5) “Create a YouTube embed for video id `dQw4w9WgXcQ`.”
   - Expect: YoutubeEmbed appears and loads.

6) “Create a document editor.”
   - Expect: DocumentEditor appears.

7) “Create a component toolbox.”
   - Expect: ComponentToolbox appears.

8) “On the kanban board, queue: move ‘PRE-161’ to Done.” (use your issue identifier)
   - Expect: card moves + pending update count increments.
   - Pre-req: have a real Linear issue titled **Demo Task A** (or whatever you seeded) in the team you’re using.

9) “On the kanban board, queue: move ‘PRE-162’ to In Progress.” (use your issue identifier)
   - Expect: card moves + pending update count increments.
   - Pre-req: have a real Linear issue titled **Demo Task B** (or whatever you seeded).

10) “Sync to Linear.”
   - Expect: pending updates clear (or shrink on partial failures).

## Lap: 5 deeper steps (2:00–5:00)

11) Paste this into ContextFeeder (manual paste, takes ~10s):
```
Demo backlog (turn into Linear issues):
- Demo Issue 1: Add onboarding tooltip
- Demo Issue 2: Improve kanban empty state
- Demo Issue 3: Add “export demo run” button
```

12) “Using the context document, rename ‘PRE-161’ to ‘Demo Issue 1: Add onboarding tooltip’.” (use your issue identifier)
   - Expect: issue title changes on the board (visible) + updated timestamp refreshes.

13) “Move ‘PRE-162’ to Done.” (use your issue identifier)
   - Expect: card moves + pending update appears.

14) “Sync to Linear.”
   - Expect: pending updates clear.

15) “Create an infographic.”
   - Expect: InfographicWidget is created (if missing) and generation starts (it should use both transcript + ContextFeeder docs).

## Ghost Racing (beat your best time)

After your first clean lap:

1. Record:
   - Total time (target < 5:00)
   - Split at 2:00 (did you clear Steps 1–10?)
   - Any failures + recovery steps

2. Run the same lap again with identical phrasing.

3. Iterate only one “tuning” change per run:
   - Shorten voice phrases (fewer tokens).
   - Pre-warm Linear: open the Kanban once before you start the stopwatch.
   - Pre-warm Cerebras: hit `/api/ai/linear-steward` once with a trivial instruction before the lap.
   - Reduce network variability: keep the ContextFeeder issue list to 2–3 items.

## Common Pit Stops (fast recovery)

- If Kanban isn’t reacting to voice updates:
  - Say: “List components.”
  - Then: “Update the LinearKanbanBoard with instruction: …”

- If Linear is rate-limiting:
  - Skip Step 12 for that run; proceed with queue + sync only.

- If Context docs aren’t being used:
  - Confirm Supabase migration + `SUPABASE_SERVICE_ROLE_KEY` set.
