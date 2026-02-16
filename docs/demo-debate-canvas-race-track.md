# Debate + Canvas Race Track (5 minutes)

Goal: a repeatable 5-minute run combining DebateScorecard and canvas outputs under server-first orchestration.

## Starting line

- `npm run stack:start`
- Recommended runtime flags:
  - `NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false`
  - `NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED=false`
  - `CANVAS_STEWARD_SERVER_EXECUTION=true`
  - `CANVAS_QUEUE_DIRECT_FALLBACK=false`
- Connected LiveKit room on `/canvas`

## Lap script

### 0:00-0:20 setup

1) "Create a timer for five minutes. Start the timer."
2) "Start a debate scorecard about: should AI labs publish safety evals before release?"

### 0:20-4:00 debate turns

Use short alternating affirmative/negative turns and optionally request fact-checking.

### 4:00-5:00 canvas finish

3) "Canvas: summarize debate as a flowchart with 6-10 nodes."
4) "Create an infographic summarizing the debate."
5) "Canvas: add a playful, readable doodle representing the debate."

## Expected outcomes

- DebateScorecard updates with claims/timeline.
- Canvas actions appear via steward execution.
- No client-side fairy execution dependency.
- Queue/steward logs show deterministic processing.

## Verification hints

- Capture request traces for `/api/steward/runCanvas`.
- Validate no usage of `/api/fairy/stream-actions`.
- Confirm no duplicate/ghost component creation under quick successive updates.
