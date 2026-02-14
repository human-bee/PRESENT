# Race Night V2: CrowdPulse + Scorecard + Fairy Canvas (2 participants)

Goal: a repeatable stress demo that validates concurrent widget updates, lifecycle recovery, and fairy/canvas orchestration in one run.

## Preconditions

- Use one shared room with two participants (A and B).
- Recommended env posture (prod/dev parity):
  - `NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false`
  - `NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED=false`
  - `CANVAS_STEWARD_SERVER_EXECUTION=true`
  - `CANVAS_QUEUE_DIRECT_FALLBACK=false`
- Start logs:
  - `tail -f logs/agent-realtime.log logs/agent-conductor.log`

## Demo Script (copy/paste utterances)

### Phase 1: Seed components (parallel)

A:
`Create a Crowd Pulse widget for Launch Readiness. Track hand count and audience questions.`

B:
`Start a Debate Scorecard about: Should we ship Friday?`

### Phase 2: Multi-update pressure (parallel rounds)

Round 1:

A:
`Update Crowd Pulse hand count to 12, confidence 0.78, add question: "Can we ship Friday?"`

B:
`Affirmative claim: We should ship Friday because blocker burn-down is complete and rollback risk is low.`

Round 2:

A:
`Update Crowd Pulse hand count to 17, status q_and_a, add question: "What blocks GA?"`

B:
`Negative rebuttal: We should not ship Friday because auth/session errors are still unresolved in production.`

Round 3:

A:
`Remove the Crowd Pulse widget.`

B (immediately):
`Recover the Crowd Pulse widget and continue with hand count 17.`

### Phase 3: Fairy canvas orchestration + view control

A:
`Use 3 fairies to draw a brutalist roadmap with 3 lanes: Risks, Mitigations, Decisions.`

B:
`Focus the canvas on the roadmap area and add links from the Debate Scorecard to the Risks lane.`

A:
`Add a status callout near Crowd Pulse and another near Debate Scorecard, with arrows to the roadmap.`

### Phase 4: Determinism check updates

A:
`Update Crowd Pulse: hand count 19, confidence 0.81, active question "What is the launch hold point?"`

B:
`Update the Debate Scorecard with a concise verdict and top 2 unresolved risks.`

## What Must Be True (Pass Criteria)

- Exactly one live `CrowdPulseWidget` after recovery.
- CrowdPulse fields (`handCount`, `confidence`, `questions`, `status`) do not appear on unrelated widgets.
- DebateScorecard remains structurally valid and keeps debate data after concurrent traffic.
- Canvas/fairy work continues while widget mutations are happening.
- Logs show queued/conductor processing, not direct mutation fallback behavior.

## Failure Signatures (Fail Fast)

- Any non-CrowdPulse component receives `handCount`/`confidence`/`questions`.
- Remove/recover leaves duplicate or ghost CrowdPulse widgets.
- Scorecard state is overwritten by CrowdPulse-like patch fields.
- Repeated `agent dispatch timeout` prevents expected tool execution.

## Evidence to Capture

- Screenshot at end state with CrowdPulse + Scorecard + roadmap visible.
- Final component snapshot export for IDs and props.
- Log snippets around:
  - enqueue/claim/complete
  - `dispatch_to_conductor`
  - `update_component` target IDs

## Optional Speed Check

Run before/after code changes:

```bash
npm run bench:racetrack
```

Compare:

- `docs/benchmarks/racetrack/latest.json`
- `docs/benchmarks/racetrack/history.jsonl`
