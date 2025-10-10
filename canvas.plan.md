<!-- a3f8dbeb-ba76-4c68-8f0a-3f548f9d52e6 2fbe5818-73ac-4d73-af58-37763ca4c6ef -->
# Canvas Steward Integration

## 1. Scaffold server-side tooling
- Add LiveKit broadcast helper for generic canvas actions alongside existing flowchart utilities in `src/lib/agents/shared/supabase-context.ts` (or companion module).
- Expose a POST route (e.g. `src/app/api/steward/dispatch/route.ts`) that forwards steward-originated canvas tool events to LiveKit, mirroring `/api/steward/commit` for flowcharts.
- Provide a lightweight `get_canvas_state` helper that summarizes current shapes from Supabase (fall back to in-memory cache, similar to flowchart docs).

## 2. Implement CanvasSteward agent
- Create `src/lib/agents/subagents/canvas-steward.ts` defining tools: `get_canvas_state`, `get_context`, and granular canvas action tools (`create_rectangle`, `create_ellipse`, `delete_shape`, etc.) that call the new dispatch endpoint.
- Instantiate the agent with concise instructions encouraging tool use, and export `runCanvasSteward` for orchestration.
- Update `src/lib/agents/subagents/index`/registry to expose the steward (similar to `flowchart-steward-registry`).

## 3. Wire conductor + triggers
- Update `src/lib/agents/conductor/index.ts` so `dispatch_to_conductor` routes `canvas.*` tasks to `runCanvasSteward`.
- Extend `src/lib/agents/realtime/voice-agent.ts` instructions to mention delegating rich drawing requests via `dispatch_to_conductor` with the `canvas.draw` task.
- Adjust `src/components/tool-dispatcher/hooks/useToolRunner.ts` (and related utils) to:
  - Recognize a canvas-specific steward decision/trigger and call the new `/api/steward/dispatch` endpoint.
  - Allow the expanded set of `canvas_` tools while steward mode is active.

## 4. Testing & docs
- Add targeted unit/Playwright coverage (e.g. draw-smiley scenario) verifying steward-triggered canvas actions reach the client and create shapes.
- Document steward usage in `docs/canvas-steward-playbook.md` (brief addendum for the Tldraw agent) and note new API route in `AGENTS.md` if helpful.

### To-dos

- [x] Add canvas dispatch API, LiveKit broadcast helper, and Supabase-backed get_canvas_state summary.
- [x] Create CanvasSteward agent with shape action tools and run helper.
- [x] Route conductor tasks, adjust voice agent prompt, update ToolDispatcher to trigger canvas steward.
- [ ] Add integration test or Playwright scenario plus documentation updates.

