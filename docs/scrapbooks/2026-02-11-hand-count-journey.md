# PRESENT Hand Count Journey (2026-02-11)

Run ID: 20260211-005809-crowd

## Story Arc

Crowd Q&A -> Hand Count -> Question Queue -> Follow-ups -> View Shift

## Hero Moments

### Crowd Pulse Dashboard

![Crowd Pulse Dashboard](./assets/2026-02-11/20260211-005809-crowd-03-crowd-created.png)

### Crowd Pulse Update (hand count + questions)

![Crowd Pulse Update (hand count + questions)](./assets/2026-02-11/20260211-005809-crowd-04-crowd-signals.png)

### Crowd Pulse Follow-ups

![Crowd Pulse Follow-ups](./assets/2026-02-11/20260211-005809-crowd-05-crowd-followups.png)

### Speaker View Preset

![Speaker View Preset](./assets/2026-02-11/20260211-005809-crowd-10-speaker-view.png)

## Journey Evidence (Screenshots)

| Step | Status | Duration (ms) | Screenshot | Notes |
| --- | --- | --- | --- | --- |
| Sign in / sign up | PASS | 18065 |  |  |
| Canvas loaded | PASS | 13319 | [20260211-005809-crowd-00-canvas.png](./assets/2026-02-11/20260211-005809-crowd-00-canvas.png) |  |
| Simulate transcript (19 turns) | PASS | 811 |  | 19 turns |
| Open transcript panel | PASS | 1446 | [20260211-005809-crowd-01-transcript.png](./assets/2026-02-11/20260211-005809-crowd-01-transcript.png) |  |
| Spawn LiveKit tiles (demo) | PASS | 1761 | [20260211-005809-crowd-02-livekit.png](./assets/2026-02-11/20260211-005809-crowd-02-livekit.png) |  |
| Create Crowd Pulse widget | PASS | 1030 | [20260211-005809-crowd-03-crowd-created.png](./assets/2026-02-11/20260211-005809-crowd-03-crowd-created.png) | paint 0 ms |
| Update Crowd Pulse with live signals | PASS | 1135 | [20260211-005809-crowd-04-crowd-signals.png](./assets/2026-02-11/20260211-005809-crowd-04-crowd-signals.png) | paint 12 ms |
| Add follow-up prompts + scores | PASS | 971 | [20260211-005809-crowd-05-crowd-followups.png](./assets/2026-02-11/20260211-005809-crowd-05-crowd-followups.png) | paint 12 ms |
| Reload + rehydrate Crowd Pulse widget | PASS | 4199 | [20260211-005809-crowd-06-crowd-rehydrated.png](./assets/2026-02-11/20260211-005809-crowd-06-crowd-rehydrated.png) |  |
| Remove Crowd Pulse widget | PASS | 2666 | [20260211-005809-crowd-07-crowd-removed.png](./assets/2026-02-11/20260211-005809-crowd-07-crowd-removed.png) | paint 3 ms |
| Reload after remove (no respawn) | PASS | 3375 | [20260211-005809-crowd-08-crowd-removed-reload.png](./assets/2026-02-11/20260211-005809-crowd-08-crowd-removed-reload.png) |  |
| Recreate Crowd Pulse with same componentId | PASS | 1130 | [20260211-005809-crowd-09-crowd-recreated.png](./assets/2026-02-11/20260211-005809-crowd-09-crowd-recreated.png) | paint 0 ms |
| Apply speaker view preset | PASS | 937 | [20260211-005809-crowd-10-speaker-view.png](./assets/2026-02-11/20260211-005809-crowd-10-speaker-view.png) | applied in 353 ms |

## Speed Benchmarks

| Operation | Duration (ms) | Budget (ms) | Result |
| --- | --- | --- | --- |
| create_component (CrowdPulseWidget) | 0 | 1300 | PASS |
| update_component (CrowdPulseWidget) | 12 | 900 | PASS |
| update_component (CrowdPulseWidget follow-ups) | 12 | 900 | PASS |
| update_component (CrowdPulseWidget post-rehydrate) | 20 | 900 | PASS |
| remove_component (CrowdPulseWidget) | 3 | 900 | PASS |
| create_component (CrowdPulseWidget recreate same id) | 0 | 1300 | PASS |
| fast-lane view preset (speaker) | 353 | 500 | PASS |

Total journey time: 50845 ms

## Notes
- Crowd pulse widget captures hand counts + question queue in real time.
- Question clustering and follow-ups are reflected in the widget.
- Speaker preset is applied via tldraw:applyViewPreset.
- Transcript events are simulated for deterministic story capture.
