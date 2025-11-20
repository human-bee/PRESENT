# Canvas Agent Capability Smoke Tests

## Before You Start

1. **Restart + isolate logs**
   - `npm run stack:restart`
   - `rm logs/agent-*.log` (or move them to `logs/archive/<date>-<test>.log`) so each run only contains the actions you care about.
2. **Launch a fresh canvas**
   - Clear `localStorage.present:lastCanvasId` (DevTools Console) and open `/canvas?fresh=1`.
   - Use the Chrome DevTools helper below to click **Connect** → **Request agent**.
3. **Voice/transcript path**
   - Tests 1, 5, 6, and 7 **must** be triggered through the chat UI (slash command or voice) to exercise the voice → conductor → steward pipeline.
   - The `/api/steward/runCanvas` helper is allowed for quick schema iterations (Tests 2–4) but run at least one full-stack prompt before recording results.
4. **Tail logs efficiently**
   - `tail -f logs/agent-conductor.log | rg --line-buffered <sessionId>` (keeps context small).
   - `tail -f logs/next-dev.log` for canvas/autosave output.
5. **Chrome DevTools helper**
   ```js
   // Run via chrome-devtools.evaluate_script
   (() => {
     const clickByText = (label) => {
       const btn = [...document.querySelectorAll('button')].find((b) =>
         b.textContent?.toLowerCase().includes(label),
       );
       if (btn) btn.click();
     };
     clickByText('connect');
     clickByText('request agent');
     return 'connected/requested';
   })();
   ```
6. **Helper curl (only when allowed)**
   ```bash
   ROOM="canvas-ROOM_ID"
   curl -s -X POST http://localhost:3000/api/steward/runCanvas \
        -H 'Content-Type: application/json' \
        -d "{\"room\":\"$ROOM\",\"task\":\"canvas.agent_prompt\",\"message\":\"PROMPT\",\"params\":{\"room\":\"$ROOM\"}}"
   ```
7. **Token discipline**
   - Use `CANVAS_AGENT_CONFIG='{"preset":"precise"}'` for parser-only tweaks; switch back to the creative preset for the official smoke run.
   - If a run fails due to infrastructure (no screenshot, LiveKit room missing), fix infra first instead of reissuing prompts blindly.
8. **Parity reminder**
   - Never add server-side patches that rewrite TLDraw actions (e.g., “fixing” draw segments). When a test fails because the model streamed an invalid action, treat it as a contract or prompt bug and align with the TLDraw starter kit instead of mutating the stream.

## Parity Harness & PNG Workflow

1. Start infra each time:
   ```bash
   fnm exec --using=22.18.0 npm run stack:restart -- --livekit --sync --web
   fnm exec --using=22.18.0 npm run teacher:worker   # serves http://127.0.0.1:8787
   export CANVAS_TEACHER_ENDPOINT=http://127.0.0.1:8787
   ```
2. For each parity run, pick a timestamp (e.g. `TS=$(date -u "+%Y-%m-%dT%H-%M-%S-%3NZ")`). The CLI now provisions a real Supabase canvas row per `(scenario, mode, timestamp)` (owned by the service user `parity-worker@present.local` by default; override via `CANVAS_PARITY_OWNER_EMAIL` if you truly need a different account) and assigns the LiveKit room `canvas-<uuid>` to match.
3. Launch the CLI with `--wait-for-client` so it can print the canonical viewer URL **before** streaming actions, e.g.:
   ```bash
   fnm exec --using=22.18.0 npx tsx scripts/canvas-parity.ts \
     --scenario=<poster|pen|layout> \
     --mode=<present|tldraw-teacher|shadow> \
     --timestamp="$TS" \
     --wait-for-client
   ```
   The script logs `Attach a TLDraw client via /canvas?room=canvas-<uuid>&id=<uuid>&parity=1` and pauses until you press Enter.
4. Attach a client using that path **while the CLI is paused**:
   - Manual: open `http://localhost:3000/canvas?room=canvas-<uuid>&id=<uuid>&parity=1` (auth bypass or an authenticated browser both work). The page now backfills `id=<uuid>` automatically when `room` matches `canvas-<uuid>` so Supabase autosave stays in sync.
   - Headless + PNG capture: `fnm exec --using=22.18.0 npx tsx scripts/canvas-parity-viewer.ts --url="http://localhost:3000${VIEWER_PATH}" --duration=45000 --screenshot="docs/parity/<scenario>-<mode>-$TS.png"`. `--screenshot-wait=2500` adds extra dwell time before capture if needed.
   After the viewer connects, press Enter in the CLI to let the agent run.
5. Artifacts land under `docs/parity/` as `<scenario>-<mode>-<timestamp>-{actions,doc,summary}.json`. Shadow runs also emit `*-metrics.json`. Each summary now includes `canvasId`, `canvasName`, `roomId`, `viewerPath`, and the suggested PNG path so the PNG workflow is fully deterministic.
6. If `[CanvasAgent:TeacherRuntimeUnavailable]` shows up, it means the HTTP worker was unreachable and only PRESENT actions ran; metrics are still useful, but teacher counts will be zero.

## V23 UI Smoke Results (2025-11-20)

- **Test 1 – Poster (UI, chat path fixed)** — room `canvas-b23adda1-d5b7-40b9-8480-8a4c1e051c6a`, shapes persisted (`shapes.length=18`). Artifacts: `docs/parity/v22-poster-ui.png`, `docs/parity/v22-poster-ui-doc.json`.
- **Test 2 – Pen (UI)** — room `canvas-17ba9e9b-436a-4cf3-a67d-8778fa9cad39`, `shapes.length=7`. Artifacts: `docs/parity/v22-pen-ui.png`, `docs/parity/v22-pen-ui-doc.json`.
- **Test 4 – Layout (UI)** — room `canvas-9e4f5653-1aab-458a-b572-641feb971450`, `shapes.length=8`. Artifacts: `docs/parity/v22-layout-ui.png`, `docs/parity/v22-layout-ui-doc.json`.
- **Test 5 – Viewport (UI)** — room `canvas-25638608-817f-4b57-bfde-389177ddef1d`. Agent emitted only `set_viewport`; `shapes.length=0` (expected for viewport-only). Artifacts: `docs/parity/v23-test5-ui.png`, `docs/parity/v23-test5-ui-doc.json`.
- **Test 6 – Todo/add_detail (UI)** — room `canvas-26fc7c8b-4758-4cf9-8884-6fb7e8345e0d`. Created hero + notes; align/distribute; `shapes.length=8`. Todos still log RLS/cache errors (`canvas_agent_todos.session_id` missing) but shapes persist. Artifacts: `docs/parity/v23-test6-ui.png`, `docs/parity/v23-test6-ui-doc.json`.
- **Test 7 – Transcript continuation (UI)** — room `canvas-5079b699-b8cf-402e-875d-2a797ee217f6`. Two-turn transcript; shapes accumulate; `shapes.length=6`. Artifacts: `docs/parity/v23-test7-ui.png`, `docs/parity/v23-test7-ui-doc.json`.
- **Test 8 – Voice (UI prompt; mic UI absent)** — room `canvas-691a9677-16cf-41cb-8e3f-547bd8a70600`. Sent voice-style `/canvas` via transcript; agent created hero + “V23 voice note” + viewport; `shapes.length=3`. Artifacts: `docs/parity/v23-test8-ui.png`, `docs/parity/v23-test8-ui-doc.json`. True mic/UI voice path still TODO.

## V23 Parity Sanity (Shadow)

- **Poster shadow run** — TS `2025-11-20T07-30-34-3NZ`, room `canvas-45d70ff9-c3cb-4124-9a08-2b2a913cbb6f`, canvas same. Present actions: 14 (`create_shape` 11, `align` 1, `distribute` 1, `reorder` 1); Teacher actions: 34 (mostly `todo` + `create_shape`); layout deltas teacher-present: align -1, distribute -1, stack 0, reorder -1. Parity `doc.json` still `shapes.length=0`; PNG `docs/parity/poster-shadow-2025-11-20T07-30-34-3NZ.png`, metrics/summary under `docs/parity/poster-shadow-2025-11-20T07-30-34-3NZ-{metrics,summary}.json`. Needs follow-up to persist snapshots in parity harness.

## V18 Smoke Matrix Results (2025-11-19)

- **Test 1 – Poster (shadow parity)** — TS `2025-11-19T21-09-34-3NZ`, room `canvas-67b94196-b8bd-45c7-a4b7-a7e6ddcaeb2e`, canvas `67b94196-b8bd-45c7-a4b7-a7e6ddcaeb2e`, viewer `/canvas?room=canvas-67b94196-b8bd-45c7-a4b7-a7e6ddcaeb2e&id=67b94196-b8bd-45c7-a4b7-a7e6ddcaeb2e&parity=1`. Artifacts: `docs/parity/poster-shadow-2025-11-19T21-09-34-3NZ-{actions,doc,summary,metrics}.json`, PNG `docs/parity/poster-shadow-2025-11-19T21-09-34-3NZ.png`. PRESENT verbs: 17 total (12 `create_shape`, `align`×1, `stack`×1, `reorder`×1, `think`×1, `todo`×1). Teacher verbs: 23 total (16 `create_shape`, `todo`×6, `think`×1); zero layout verbs. `doc.json.shapes` length: **0** (still empty; relying on PNG + metrics).
- **Test 2 – Pen (shadow parity)** — TS `2025-11-19T21-12-13-3NZ`, room `canvas-41d57255-b0d1-4860-82e7-114882d8e812`, canvas `41d57255-b0d1-4860-82e7-114882d8e812`, viewer `/canvas?room=canvas-41d57255-b0d1-4860-82e7-114882d8e812&id=41d57255-b0d1-4860-82e7-114882d8e812&parity=1`. Artifacts: `docs/parity/pen-shadow-2025-11-19T21-12-13-3NZ-{actions,doc,summary,metrics}.json`, PNG `docs/parity/pen-shadow-2025-11-19T21-12-13-3NZ.png`. PRESENT verbs: 6 (`create_shape` draw strokes only). Teacher verbs: 10 (`create_shape`×4, `todo`×5, `think`×1). Layout verbs: none (expected for pen). `doc.json.shapes` length: **0**.
- **Tests 3–4 – Layout (shadow parity)** — TS `2025-11-19T21-14-18-3NZ`, room `canvas-4e03370b-4c65-41b6-b727-99e043d19d74`, canvas `4e03370b-4c65-41b6-b727-99e043d19d74`, viewer `/canvas?room=canvas-4e03370b-4c65-41b6-b727-99e043d19d74&id=4e03370b-4c65-41b6-b727-99e043d19d74&parity=1`. Artifacts: `docs/parity/layout-shadow-2025-11-19T21-14-18-3NZ-{actions,doc,summary,metrics}.json`, PNG `docs/parity/layout-shadow-2025-11-19T21-14-18-3NZ.png`. PRESENT verbs: 10 total (`create_shape`×5, `align`×2, `distribute`×1, `stack`×1, `reorder`×1). Teacher verbs: 18 (`todo`×10, `think`×4, `create_shape`×3, `align`×1). Layout delta (teacher – present): `align -1`, `distribute -1`, `stack -1`, `reorder -1`. `doc.json.shapes` length: **0**.
- **Tests 5–7 (viewport / todo-add_detail / transcript continuation)** — Not exercised in V18 (UI chat/voice path still idle; agent request remained disabled after Connect while voice/conductor stack was off). TODO for next pass once voice agent + conductor are running.

## Parity Planning (V15)

- Poster scenario ⇢ **Smoke Test 1**: present/teacher/shadow JSON + metrics exist for `2025-11-19T11-29..`. With the new Supabase mapping the next rerun will persist real TLDraw snapshots + PNGs (viewer path now encoded in each summary).
- Pen scenario ⇢ **Smoke Test 2**: `--scenario=pen --mode=shadow` remains the go-to freehand baseline. Once screenshots are captured, compare draw-path fidelity between PRESENT and teacher to tune the prompt/examples if needed.
- Layout scenario ⇢ **Smoke Tests 3–4**: config is live in `SCENARIOS.layout`. After the poster + pen reruns confirm Supabase persistence, run `--scenario=layout --mode=shadow --wait-for-client` and capture both metrics + PNGs to quantify align/distribute/stack usage.
- Operational reminders: keep LiveKit stack + teacher worker running, set `CANVAS_TEACHER_ENDPOINT`, and rely on the CLI’s `viewerPath` hint + `scripts/canvas-parity-viewer.ts --screenshot=...` for reproducible PNG capture. Without the HTTP worker you’ll still see `[CanvasAgent:TeacherRuntimeUnavailable]` (teacher counts zero) even though PRESENT artifacts are valid.

## Test Matrix
| # | Capability | Prompt | Expectation |
|---|------------|--------|-------------|
|1|Baseline layout + macros|"Draft a brutalist poster concept: burnt orange hero, asymmetrical layout, 3 sticky notes for copy ideas."| ~50+ TLDraw actions, preset macros only; screenshot saved to `docs/examples/brutalist-poster.png`, autosave log fires.|
|2|Freehand strokes|"Use the draw pen to sketch a bold underline beneath the hero headline and a zig-zag divider, then add a sticky note explaining the strokes."| `create_shape` actions with `type:'draw'` + `props.segments` logged; TLDraw renders freehand lines; sticky note at described coords.|
|3|Move/resize/rotate|"Resize the hero block 20% larger, rotate the right sticky by 8°, and center-align the three notes."| `resize`, `rotate`, `align` actions emitted; no validation errors.|
|4|Group/stack/reorder|"Group the three sticky notes, stack them vertically with 32px spacing, and send the background frame to back."| `group`, `stack`, `reorder` actions present; frame remains visible post autosave.|
|5|Viewport move + follow-up (voice)|"Pan to the far right of the canvas and add a quiet label there; if still sparse, take a follow-up screenshot and continue." (send through chat input)| `set_viewport` completes (bounds fully populated), quiet label uses `apply_preset Quiet`, follow-up run triggers when actionCount < threshold; second screenshot saved.|
|6|Todo/add_detail loop|"Jot two todos about typography, then ask for clarification on which headline to keep." (chat input)| `todo` entries streamed; `add_detail` hint references the correct shape IDs; UI log shows `custom:sessionCanvasSaved`.|
|7|Transcript continuation|"Using the last user request, continue the poster: reuse the existing hero and add a callout note beneath it." (send via `/canvas continue …`)| Agent references previous transcript, uses `update_shape`/`move` instead of recreating hero, and no `[ActionDrops] invalidSchema` spikes.|
|8|Brand compliance check|"Apply the Hero preset to the headline and Quiet presets to three notes; avoid raw TLDraw color names."| All styling goes through `apply_preset`; screenshot shows palette sticking to brand defaults (burnt orange, charcoal); log shows zero direct `update_shape` color overrides.

## Verification Checklist per run
1. **Logs**
   - `[CanvasAgent:ActionsRaw]` shows the canonical verbs for the test.
   - `[CanvasAgent:ActionDrops]` invalidSchema count stays under 3 (otherwise note the failure).
   - `[CanvasAgent:Metrics] event:"ttfb"` < 800 ms once cache is warm; record the value.
2. **Browser console**
   - No `ValidationError`; screenshot RPC logs show `result:"received"`.
   - Voice/Transcript tests show the chat message inside the transcript pane.
3. **Autosave**
   - `[CanvasPersistence] Auto-saving after agent run` within ~2 s of `agent:status done`.
4. **Visual QA**
   - Capture a baseline PNG **before** the test (fresh canvas) and the result PNG after the agent run; store them under `docs/examples/smoke-<date>-testN-{before,after}.png`.
   - Judge brand compliance (Hero/Quiet presets, spacing, no random colors) and confirm the “after” screenshot shows real output (no Next.js error modal or blank UI). If you see an error overlay (e.g., Polyline2d) or an empty board, mark the test failed and log the error.
5. **Pipeline coverage**
   - For voice/chat tests, confirm the transcript entry matches the prompt and that `agent_tasks` records show the voice agent enqueued the job.
6. **Follow-up validation**
   - When follow-ups are expected, ensure the second run fires (new sessionId) and references the previous `add_detail`/todo hint.

Document results inline (date, commit, room) before closing the run.
