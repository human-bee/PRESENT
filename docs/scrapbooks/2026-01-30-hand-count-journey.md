# PRESENT Hand Count Journey (2026-01-30)

Run ID: 20260130-034208-crowd

## Story Arc

Crowd Q&A -> Hand Count -> Question Queue -> Follow-ups -> View Shift

## Hero Moments

### Crowd Pulse Dashboard

![Crowd Pulse Dashboard](./assets/2026-01-30/20260130-034208-crowd-03-crowd-created.png)

### Crowd Pulse Update (hand count + questions)

![Crowd Pulse Update (hand count + questions)](./assets/2026-01-30/20260130-034208-crowd-04-crowd-signals.png)

### Crowd Pulse Follow-ups

![Crowd Pulse Follow-ups](./assets/2026-01-30/20260130-034208-crowd-05-crowd-followups.png)

### Speaker View Preset

![Speaker View Preset](./assets/2026-01-30/20260130-034208-crowd-06-speaker-view.png)

## Journey Evidence (Screenshots)

| Step | Status | Duration (ms) | Screenshot | Notes |
| --- | --- | --- | --- | --- |
| Sign in / sign up | PASS | 4796 |  |  |
| Canvas loaded | PASS | 4896 | [20260130-034208-crowd-00-canvas.png](./assets/2026-01-30/20260130-034208-crowd-00-canvas.png) |  |
| Simulate transcript (19 turns) | PASS | 805 |  | 19 turns |
| Open transcript panel | PASS | 1081 | [20260130-034208-crowd-01-transcript.png](./assets/2026-01-30/20260130-034208-crowd-01-transcript.png) |  |
| Spawn LiveKit tiles (demo) | PASS | 1557 | [20260130-034208-crowd-02-livekit.png](./assets/2026-01-30/20260130-034208-crowd-02-livekit.png) |  |
| Create Crowd Pulse widget | PASS | 983 | [20260130-034208-crowd-03-crowd-created.png](./assets/2026-01-30/20260130-034208-crowd-03-crowd-created.png) | paint 0 ms |
| Update Crowd Pulse with live signals | PASS | 690 | [20260130-034208-crowd-04-crowd-signals.png](./assets/2026-01-30/20260130-034208-crowd-04-crowd-signals.png) | paint 11 ms |
| Add follow-up prompts + scores | PASS | 805 | [20260130-034208-crowd-05-crowd-followups.png](./assets/2026-01-30/20260130-034208-crowd-05-crowd-followups.png) | paint 3 ms |
| Apply speaker view preset | PASS | 828 | [20260130-034208-crowd-06-speaker-view.png](./assets/2026-01-30/20260130-034208-crowd-06-speaker-view.png) | applied in 352 ms |

## Speed Benchmarks

| Operation | Duration (ms) | Budget (ms) | Result |
| --- | --- | --- | --- |
| create_component (CrowdPulseWidget) | 0 | 1300 | PASS |
| update_component (CrowdPulseWidget) | 11 | 900 | PASS |
| update_component (CrowdPulseWidget follow-ups) | 3 | 900 | PASS |
| fast-lane view preset (speaker) | 352 | 500 | PASS |

Total journey time: 16441 ms

## Notes
- Crowd pulse widget captures hand counts + question queue in real time.
- Question clustering and follow-ups are reflected in the widget.
- Speaker preset is applied via tldraw:applyViewPreset.
- Transcript events are simulated for deterministic story capture.
