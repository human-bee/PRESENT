# Demo Racetrack: 5‑Minute Debate Lap

Goal: a repeatable, voice‑agent‑driven lap that shows off realtime orchestration + stewards + canvas artifacts.

## Prereqs

- Copy `example.env.local` → `.env.local` and fill required keys (LiveKit + OpenAI + Supabase).
- Optional (recommended for the demo): set `LINEAR_API_KEY` in `.env.local` so the Linear Kanban loads immediately in dev.
- Start the stack (3 terminals or one script):
  - `npm run stack:start`
  - (or manually: `npm run agent:realtime`, `npm run agent:conductor`, `npm run sync:dev`, `npm run dev`, plus LiveKit server)

## Lap Script (what you say to the voice agent)

### 0:00–0:20 — Setup widgets

1) “Start a 5 minute timer and start it now.”
2) “Create a Linear Kanban board.”
3) “Start a debate analysis scorecard about: Should AI labs be required to publish safety evals before release?”

Expected:
- Timer shows running countdown.
- Kanban appears (and loads issues if `LINEAR_API_KEY` is present).
- DebateScorecard title matches the topic; sides are labeled (e.g. “You” vs “Opponent” or participant names).

### 0:20–4:00 — Debate (compressed or real‑time)

Feed turns like:
- “Affirmative: Publishing evals reduces catastrophic risk and improves accountability.”
- “Negative: Mandatory pre‑release eval publication risks leaks and slows innovation; do evals privately.”
- “Affirmative rebuttal: Private evals are not credible—publish at least summaries + methodology.”
- “Negative rebuttal: Publication incentives can lead to performative safety theater; focus on audits.”
- “Judge: propose a phased disclosure policy and weigh transparency vs security risks.”

Expected:
- Scorecard ledger fills with claims.
- Total points exchanged increments.
- Timeline records debate + scoring events.

Optional (explicit “bells & whistles”):
- “Fact-check the two most important factual claims and add sources to the scorecard.”

Expected:
- Sources tab populates (links/evidence refs).
- Some claims move to CHECKING/VERIFIED/REFUTED.

### 4:00–5:00 — Canvas extravaganza

1) “Canvas: create a clean flowchart summary of the debate (clear nodes + arrows).”
2) “Generate an infographic summarizing the debate.”
3) “Canvas: add a playful doodle that represents the debate (fun but readable).”

Expected:
- Flowchart shapes appear on canvas.
- Infographic widget renders a generated image.
- A draw/doodle shape appears.

### Finish — Follow-up tickets

“On the kanban board: add two tickets: ‘Research pro (transparency)’ assigned to me, and ‘Research con (private evals)’ assigned to the other participant.”

Expected:
- Two new tickets appear on the board.

## One-command “verified report” (screenshots + assertions)

Runs the lap via Playwright, asserts each deliverable, and writes a Markdown report with screenshots:

- `npx playwright test tests/debate-lap-report.e2e.spec.ts`

Output directory:
- `~/Downloads/present-demo-debate-lap-report-<timestamp>/`

## Troubleshooting

- Scorecard title/labels not updating: restart the stack (`npm run stack:restart`) to ensure agents are on the latest code.
- Linear board shows API key prompt: set `LINEAR_API_KEY` in `.env.local` (dev fallback) or save a key in the UI.
- Widgets overlap: use the toolbox to add widgets; non-canvas-agent widgets are auto‑tiled on placement.

