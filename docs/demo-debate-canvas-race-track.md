# Debate + Canvas Spectacle Race Track (5 minutes)

Goal: a repeatable 5‑minute “lap” that shows **voice steering**, a live **DebateScorecard**, and a 60‑second **canvas finale** (flowchart + infographic + doodle + Linear followups).

## Starting Line (consistent for every lap)

- Stack running: `npm run stack:start`
- Recommended for demo reliability: run the realtime agent with `VOICE_AGENT_UPDATE_LOSSY=false`
- You’re on `/canvas` in your demo room and connected to LiveKit
- Conductor is running (needed for scorecard + canvas stewards)
- LinearKanbanBoard has a valid Linear API key saved locally (one-time)
- Supabase migration applied: `docs/migrations/002_add_context_documents_to_sessions.md`

## Timing Rules

- Start the stopwatch when you speak Step 1.
- The lap “counts” if all steps complete within **5:00**.
- The 4‑minute debate section can be a real two‑person debate, or you can roleplay both sides quickly.

## Lap (5:00 total)

### 0:00–0:20 — Setup

1) “Create a timer for five minutes. Start the timer.”
   - Expect: RetroTimerEnhanced appears and starts counting down.

2) “Create a kanban board.”
   - Expect: LinearKanbanBoard appears (skeleton is fine).

3) “Start a debate scorecard about: *Should AI labs be required to publish safety evals before release?*”
   - Expect: DebateScorecard appears and begins updating as you talk.

### 0:20–4:00 — 4‑minute debate (live)

Keep it fast and structured. Aim for 6–8 short turns total.

Suggested script (swap in your own topic if you want):
- “Affirmative: Publishing evals reduces catastrophic risk and improves accountability.”
- “Negative: Mandatory publication creates info hazards and slows beneficial deployment.”
- “Aff: We can publish sanitized results + protocols, not raw exploit details.”
- “Neg: Even sanitized evals can leak capability signals; audits should be private.”
- “Aff: Independent third-party audits + a public summary is a workable middle ground.”
- “Neg: Enforcement and international coordination remain unsolved; incentives may backfire.”

Optional “bell/whistle” callouts during the debate:
- “Fact check that last claim.” (the scorecard steward should run a fact-check task)
- “Update the scorecard with the strongest arguments from both sides.”

### 4:00–5:00 — 60‑second canvas extravaganza

4) “Canvas: summarize the debate as a flowchart with 6–10 nodes.”
   - Expect: the Canvas steward draws a flowchart on the canvas.

5) “Create an infographic summarizing the debate.”
   - Expect: InfographicWidget appears and starts generation (spinner is fine).

6) “Canvas: add a playful doodle that represents the debate (fun but readable).”
   - Expect: the Canvas steward draws a small sketch/decoration on the canvas.

7) “On the kanban board: create two issues:
   - ‘Research (me): strongest affirmative evidence for eval publication’
   - ‘Research (them): strongest negative evidence / infohazard tradeoffs’”
   - Expect: issues appear on the board (and in Linear if MCP is configured).

## Ghost Racing (make it faster)

- Shorten phrasing (fewer tokens → faster routing).
- Pre-warm: open `/canvas` once, connect LiveKit, request agent, then start the stopwatch.
- Keep the debate script consistent so the scorecard + infographic are deterministic.
