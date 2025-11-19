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

1. Run `tsx scripts/canvas-parity.ts --scenario=poster --mode=shadow` (or `--mode=present|tldraw-teacher`) **after** you restart the stack **and** start the teacher worker (`npm run teacher:worker`, which serves `http://localhost:8787` by default). The runner uses `CANVAS_TEACHER_ENDPOINT` to talk to that worker; if it is missing, `[CanvasAgent:TeacherRuntimeUnavailable]` shows up in logs and teacher metrics stay empty while PRESENT still records actions.
2. The script writes `*-actions.json`, `*-doc.json`, `*-summary.json`, and for shadow runs `*-metrics.json` to `docs/parity/`.
3. Open `/canvas?room=<roomId>` using the `roomId` inside each `*-summary.json`, capture a PNG once autosave finishes, and save it to the `suggestedPng` path noted in that summary (e.g., `docs/parity/poster-shadow-<ts>.png`).
4. Compare the PNGs next to the summary + metrics output to evaluate layout/verb differences before tweaking prompts or schemas.
   - If the CLI prints `[CanvasAgent:TeacherRuntimeUnavailable]`, it just means the vendored TLDraw worker couldn’t load in this environment; PRESENT artifacts are still valid, but teacher verb counts will be zero until the worker is moved out of the Next.js runtime.

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
