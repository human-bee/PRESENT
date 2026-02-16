# Demo Racetrack: 5-Minute Debate Lap

Goal: showcase realtime voice + scorecard + canvas behavior on the **supported server-first path**.

## Prereqs

- `.env.local` configured for LiveKit/OpenAI/Supabase.
- Optional: `LINEAR_API_KEY` for board steps.
- Start stack: `npm run stack:start`.
- Keep client agents off:
  - `NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false`
  - `NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED=false`

## Lap script (voice)

### 0:00-0:20

1) "Start a 5 minute timer and start it now."
2) "Create a Linear Kanban board."
3) "Start a debate scorecard about should AI labs publish safety evals before release."

### 0:20-4:00

Run short debate turns for both sides and optionally request fact-check.

### 4:00-5:00

1) "Canvas: create a clean flowchart summary of the debate."
2) "Generate an infographic summarizing the debate."
3) "Canvas: add a playful readable doodle that represents the debate."

### Finish

"On the kanban board add two research tickets, one pro and one con."

## Validation checklist

- Scorecard claim/timeline updates appear.
- Canvas output appears without client fairy execution.
- Relevant API calls route through `/api/steward/runCanvas`.
- No dependency on `/api/fairy/stream-actions`.

## Optional verification harness

Run:

```bash
npx playwright test tests/fairy-voice-agent-lap.e2e.spec.ts
```

Use generated report/screenshots to compare lap quality between commits.
