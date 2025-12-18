# Demo Playbook: 5‑Minute Debate Lap

Goal: run a tight 5‑minute “debate lap” driven by the **Voice Agent** (Agent #1), showing timer + debate scorecard + infographic + canvas agent + Linear followups.

## Preflight (1 minute)

- Start stack (three terminals or background):
  - `npm run agent:realtime`
  - `npm run agent:conductor`
  - `npm run dev`
  - (optional) `npm run lk:server:dev` + `npm run sync:dev` if you’re not using hosted LiveKit/sync
- In the UI:
  - Connect to LiveKit (Command‑K → Connect).
  - Click “Request agent”.

## Lap Script (5 minutes)

### 0:00–0:20 — Widgets

1) **Timer**
   - “Start a 5 minute timer and start it now.”

2) **Linear Kanban**
   - “Create a Linear Kanban board.”

3) **Debate Scorecard**
   - “Start a debate analysis scorecard about: Should AI labs be required to publish safety evals before release?”

### 0:20–4:00 — Debate (compressed)

Rapid‑fire a few turns:
- “Affirmative: Publishing evals reduces catastrophic risk and improves accountability.”
- “Negative: Mandatory pre‑release eval publication risks leaks and slows innovation; do evals privately.”
- “Affirmative rebuttal: Private evals are not credible—publish at least summaries + methodology.”
- “Negative rebuttal: Publication incentives can lead to performative safety theater; focus on audits.”
- “Judge: weigh transparency benefits vs security/competition risks; propose phased disclosure policy.”

### 4:00–5:00 — Canvas extravaganza

4) **Flowchart summary (Canvas Agent)**
   - “Canvas: create a clean flowchart summary of the debate (clear nodes + arrows).”

5) **Infographic**
   - “Generate an infographic summarizing the debate.”

6) **Doodle (Canvas Agent)**
   - “Canvas: add a playful doodle that represents the debate (fun but readable).”

7) **Linear followups**
   - “On the kanban board: add a ticket for me to research the pro argument, and a ticket for the other person to research the con argument.”

## Automated verification (screenshot report)

This generates a Markdown report + screenshots under `~/Downloads/`:

- Ensure stack is running: `npm run stack:restart`
- Run: `npx playwright test tests/debate-lap-report.e2e.spec.ts`

The test asserts each deliverable is visible (timer running, scorecard rows, infographic image, doodle shape, followup ticket titles) and writes:

- `~/Downloads/present-demo-debate-lap-report-YYYYMMDD-HHMMSS/debate-lap-report.md`
- `~/Downloads/present-demo-debate-lap-report-YYYYMMDD-HHMMSS/images/*.png`
