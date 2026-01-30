# PRESENT Wow Journey Scrapbook (2026-01-30)

Run ID: 20260130-034048

## Story Arc

Debate -> Verification -> Memory -> Visuals -> Live Layout

This run demonstrates the new paradigms:
- High-density debate scorecard with live metrics
- Memory recall loop (vector intelligence)
- MCP App view rendering inside the canvas
- Fast-lane view presets for instant layout shifts

## Hero Moments

### Debate Scorecard (multi-facet view)

![Debate Scorecard (multi-facet view)](./assets/2026-01-30/20260130-034048-01-debate-scorecard.png)

### Scorecard update (claims + metrics)

![Scorecard update (claims + metrics)](./assets/2026-01-30/20260130-034048-02-scorecard-updated.png)

### MCP App View (tool + UI)

![MCP App View (tool + UI)](./assets/2026-01-30/20260130-034048-05-mcp-app.png)

### Presenter View Preset (fast lane)

![Presenter View Preset (fast lane)](./assets/2026-01-30/20260130-034048-07-view-preset.png)

## Journey Evidence (Screenshots)

| Step | Status | Duration (ms) | Screenshot | Notes |
| --- | --- | --- | --- | --- |
| Sign in / sign up | PASS | 4458 |  |  |
| Canvas loaded | PASS | 4403 | [20260130-034048-00-canvas.png](./assets/2026-01-30/20260130-034048-00-canvas.png) |  |
| Simulate transcript (15 turns) | PASS | 803 |  | 15 turns |
| Open transcript panel | PASS | 1025 | [20260130-034048-01-transcript.png](./assets/2026-01-30/20260130-034048-01-transcript.png) |  |
| Seed debate scorecard | PASS | 1215 | [20260130-034048-01-debate-scorecard.png](./assets/2026-01-30/20260130-034048-01-debate-scorecard.png) | paint 0 ms |
| Update scorecard signals | PASS | 1080 | [20260130-034048-02-scorecard-updated.png](./assets/2026-01-30/20260130-034048-02-scorecard-updated.png) | paint 22 ms |
| Create memory recall widget | PASS | 1294 | [20260130-034048-03-memory-created.png](./assets/2026-01-30/20260130-034048-03-memory-created.png) | paint 0 ms |
| Populate memory recall results | PASS | 1185 | [20260130-034048-04-memory-results.png](./assets/2026-01-30/20260130-034048-04-memory-results.png) | paint 20 ms |
| Render MCP App view | PASS | 1376 | [20260130-034048-05-mcp-app.png](./assets/2026-01-30/20260130-034048-05-mcp-app.png) | paint 0 ms |
| Spawn LiveKit tiles | PASS | 1976 | [20260130-034048-06-livekit-tiles.png](./assets/2026-01-30/20260130-034048-06-livekit-tiles.png) |  |
| Apply presenter view preset | PASS | 512 | [20260130-034048-07-view-preset.png](./assets/2026-01-30/20260130-034048-07-view-preset.png) | applied in 3 ms |

## Speed Benchmarks

| Operation | Duration (ms) | Budget (ms) | Result |
| --- | --- | --- | --- |
| create_component (DebateScorecard) | 0 | 1400 | PASS |
| update_component (DebateScorecard) | 22 | 900 | PASS |
| create_component (MemoryRecallWidget) | 0 | 1200 | PASS |
| update_component (MemoryRecallWidget) | 20 | 900 | PASS |
| create_component (McpAppWidget) | 0 | 1400 | PASS |
| fast-lane view preset (presenter) | 3 | 500 | PASS |

Total journey time: 19327 ms

## Notes
- Debate scorecard seeded via create_component with structured state.
- Memory recall results are injected for deterministic visuals.
- MCP App demo uses a static ui resource (public/mcp-apps/demo.html).
- Presenter preset uses fast-lane tldraw:applyViewPreset.
