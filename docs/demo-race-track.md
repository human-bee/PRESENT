# Demo Race Track (15 steps / 5 minutes)

Goal: a repeatable lap that stress-tests the current server-first agent pipeline:

Voice -> queue/conductor -> stewards -> widgets/canvas.

For concurrency-first CrowdPulse/Scorecard/Fairy variant, see:
`docs/demo-race-night-v2.md`

## Starting line

- Stack running: `npm run stack:start`
- Recommended runtime flags:
  - `NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false`
  - `NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED=false`
  - `CANVAS_STEWARD_SERVER_EXECUTION=true`
  - `CANVAS_QUEUE_DIRECT_FALLBACK=false`
- You are on `/canvas` and connected to LiveKit.
- LinearKanbanBoard has a valid API key if using Linear steps.

## Timing rules

- Start stopwatch at Step 1.
- Checkpoint at **2:00** for Steps 1-10.
- Finish target at **5:00** for Steps 1-15.

## Lap: 10 fast steps (0:00-2:00)

1-2) "Create a kanban board and a context feeder."
3) "Create a timer for five minutes."
4) "Start the timer."
5) "Create a YouTube embed for video id dQw4w9WgXcQ."
6) "Create a document editor."
7) "Create a component toolbox."
8) "On the kanban board, queue: move PRE-161 to Done."
9) "On the kanban board, queue: move PRE-162 to In Progress."
10) "Sync to Linear."

## Lap: 5 deeper steps (2:00-5:00)

11) Paste ContextFeeder backlog.
12) Rename PRE-161 from context doc.
13) Move PRE-162 to Done.
14) Sync to Linear.
15) Create an infographic.

## What to verify

- Widget creation/update/remove flows are deterministic.
- Requests route through `/api/steward/runCanvas` where applicable.
- No dependency on `/api/fairy/stream-actions`.
- Pending/synced status behaves correctly for Linear operations.

## Quick troubleshooting

- If queue path is failing, inspect `logs/agent-conductor.log` and API traces.
- If updates appear out of order, verify lock/idempotency metadata in request payloads.
- If fairness/fairy-like prompts no-op, confirm client-agent flags are still disabled and server steward execution is enabled.
