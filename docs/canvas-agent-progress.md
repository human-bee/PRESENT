# Canvas Agent Parity Progress Log

> **Purpose for future runs (LLMs + humans)**  
> This file is the single source of truth for the TLDraw canvas agent parity effort.  
> When you (the next LLM) pick up this work, **read this file first** before diving into code or logs.

Last updated: 2025-11-18  
Owner: canvas agent / steward stack (voice → conductor → canvas)

---

## 1. North Star

- **Goal**: Reach *practical parity* with the TLDraw SDK 4.x agent starter kit for canvas reasoning and composition, while keeping our extra layers (voice, LiveKit, Supabase queue, multi-room) as thin adapters around a **canonical canvas agent**.
- **Success looks like**:
  - On a fresh canvas, the “brutalist poster” and smoke-test prompts produce **balanced, intentional layouts**, not just many valid but chaotic actions.
  - The agent uses the **same mental model and tools** as TLDraw’s agent (shapes + events), with brand presets and voice/queue layered on top.
  - The runtime harness (sanitizers, dedupe, env knobs) is **minimal and explainable**, not a pile of opaque duct tape.

---

## 2. Canonical Contract (What the Canvas Agent *Is*)

Treat this as our local analogue to TLDraw’s `templates/agent` + `fairy-shared`:

- **Inputs (per run)**:
  - Prompt parts: user request, recent transcript, viewport info, screenshot, simple/blurry shapes, peripheral clusters, todos.
  - Static context: system prompt, tool catalog, few-shot examples, brand presets (for styling only).
- **Outputs**:
  - A stream of **TLDraw-native actions/events only** (no direct Supabase/LiveKit operations).
  - Optional macros (e.g., `apply_preset`) that **expand into canonical events** before reaching the client.
- **Out of scope for the agent itself**:
  - LiveKit session management, Supabase queueing, database writes, autosave, room selection.
  - Those belong to voice agent, conductor, and app adapters.

If you add a new responsibility, confirm it belongs **inside** this contract; otherwise, move it to an adapter.

---

## 3. Current State (High-Level Snapshot)

Keep this short and update as behavior changes.

- Canvas agent now:
  - Receives screenshot + viewport shapes + transcript and emits long TLDraw action chains.
  - Supports brand macros (`apply_preset`) that expand into `create_shape` / `update_shape` operations using shared `BRAND_PRESETS`.
  - Canonical contract pieces (schemas, tool catalog, few-shot examples) now live under `src/lib/canvas-agent/contract/` so both server + client share the same definitions.
  - Has richer system prompt + tool catalog + smoke tests, but **composition quality is still weak**: overlapping text, timid draw usage, many redundant actions.
- Extra layers:
  - Voice agent + conductor + Supabase queue are wired end-to-end; prompts reach the canvas steward reliably.
  - Screenshot retries and prompt caching are implemented but somewhat over-parameterized.

---

## 4. Known Gaps vs TLDraw Agent Template

Use this section to avoid re-discovering the same issues after context compression.

1. **Schema / tools drift**
   - Avoid introducing bespoke verbs (we previously had a `draw_pen` action).  
   - TLDraw agent uses **shapes + events only**; pen strokes should be `create_shape(type: 'draw')`, not a separate tool.
2. **Overweight sanitization & dedupe**
   - Runner has multiple layers of normalization, dedupe, and env-driven behavior.  
   - Some logic drops or rewrites actions in ways the model cannot see, which may waste tokens and hurt creativity. Our contract should match TLDraw’s agent (no server-side shape fixes); if an action is wrong, fix the prompt/examples instead of rewriting it post-hoc.
3. **Prompt & examples underpowered for composition and pen usage**
   - We added rules and a tool catalog, but still lack **full, end-to-end examples** (poster, storyboard, sticky cluster) at the quality of TLDraw’s templates.
   - Pen usage still fails (Test 2) because the model streams incomplete point arrays; fix this via prompts/tool catalog rather than steward patches.
4. **Action-stream buffering still ad-hoc**
   - We recently buffered `set_viewport` bounds server-side; that kind of patch should move into the shared contract or, ideally, the model prompt. Audit `sanitizeActions`, `normalizeRawAction`, and any other spots that mutate model output so they align with the starter kit’s light-touch approach.
4. **Architecture boundaries blurred**
   - The steward/runner currently mixes:
     - Agent contract (schemas, tools, macros),
     - Infrastructure concerns (Supabase autosave, retries, logging),
     - Debug/diagnostic knobs.
5. **Knob surface too large**
  - Many env vars for screenshots, retries, thresholds, etc. Some exist to work around issues that should instead be solved in the prompt/schema.

### Upstream guardrails (2025-11-18 research refresh)

- **Keep the agent contract ridiculously small.** The TLDraw starter kit funnels everything through `AgentActionUtil` helpers that expand to TLDraw-native verbs; no unseen sanitizers or dedupers exist outside that helper layer, which keeps the model accountable for every TLDraw action it emits.citeturn2open0
- **Fairy worker = caching + sequencing, not rewriting.** The production `fairy-worker` focuses on Durable Object persistence, prompt caching, and worker-to-worker fan-out; it never mutates the canvas actions, reinforcing that we should solve schema or composition problems at the prompt/examples level.citeturn3open0
- **Branching-chat templates emphasize end-to-end transcripts.** Queries, tool events, and screenshots stay in one chronological log so models see their own past work; our smoke tests should mimic that flow instead of firing isolated `/api` calls.citeturn5open0
- **Sync templates show minimal knobs.** The Cloudflare sync template only exposes a handful of configuration points (room ID, binding secrets), confirming that our sprawling env matrix is counter to upstream design philosophy.citeturn6open0
- **PR #6909 (starter kit polish)** shipped improved prompt scaffolding and TLDraw-native postprocessing entirely inside the template, highlighting that we should import their helpers wholesale instead of rewriting them piecemeal.citeturn7open0

---

## 5. In-Flight Plan (Next Concrete Milestones)

Update this list as items complete or priorities change. Keep it small and realistic.

### Phase A — Canonicalize Tools and Schema

- [x] **A1. Normalize tool names to TLDraw schema**
  - Remove/rename any non-canonical verbs (e.g., `draw_pen`) so the model speaks in:
    - `create_shape`, `update_shape`, `move`, `delete`, `align`, `distribute`, `stack`, `reorder`,
    - `set_viewport`, `review`, `message`, `todo`/`update_todo_list`, `add_detail`,
    - optional macros: `apply_preset` (must expand into canonical actions only).
- [x] **A2. Extract a shared “canvas-agent contract” module**
  - `src/lib/canvas-agent/contract/` now houses:
    - Zod schemas for actions + tool catalog.
    - Transform helpers (type coercions, id normalization, shape prop sanitizer).
    - Few-shot definitions and the base system prompt.
  - Runner + client depend solely on this module for agent contracts; any new verbs/prompts must be added there first.

### Phase B — Prompt & Composition Parity

- [x] **B1. Port starter-kit composition guidance**
  - System prompt now mirrors TLDraw guidance (hierarchy, 32px rhythm, multi-pass workflow, arrow etiquette, review/todo reminders).
- [x] **B2. Add 2–3 full few-shot examples**
  - Shared contract few-shots now cover: brutalist poster, three-panel storyboard, sticky-note cluster/follow-up, and reuse of existing hero blocks using update/move.
  - All examples rely on canonical tools (incl. `type: 'draw'` shapes for pen marks) and demonstrate align/distribute/stack usage.

### Phase C — Simplify Runtime Harness

- [ ] **C1. Thin sanitization / dedupe to “schema + light transforms”**
  - Keep:
    - Structural validation (via Zod or similar),
    - Simple coercions (numbers, enums, type synonyms),
    - Safe ID normalization.
  - Remove or demote:
    - Hidden dropping of plausible actions,
    - Overly clever dedupe that the model doesn’t understand.
- [ ] **C2. Consolidate env knobs into a small config**
  - Group screenshot/prompt settings into a single config object with sane defaults.
  - Deprecate unused or redundant env vars after behavior stabilizes.

### Phase D — Evaluation & A/B

- [ ] **D1. Re-run smoke suite with visual criteria**
  - Use `docs/canvas-agent-smoke-tests.md` tests and:
    - Verify no crashes,
    - Judge composition in PNGs (hierarchy, spacing, clarity),
    - Note draw usage and diversity of tools.
- [ ] **D2. Optional: A/B “pure template agent” vs extended agent**
  - Add a dev-only flag to run a minimal, template-like canvas agent on the same canvas for comparison.

---

## 6. Completed Work (Keep This Brief but Specific)

This is a chronological list of *impactful* changes already in place. Add items when they meaningfully move the needle.

- [x] Shared brand presets module (`src/lib/brand/brand-presets.ts`) used by both UI and steward; `apply_preset` macro expands into TLDraw actions.
- [x] Screenshot reliability improved: retry helper, inbox polling, and metrics logging prevent “blank canvas” prompts.
- [x] Prompt caching + Anthropic ephemeral cache set up for static context; screenshots are excluded from cache.
- [x] Canvas smoke tests doc + basic PNG evidence created; revealed that **composition quality** (not just action count) is the main remaining gap.
- [x] Removed the custom `draw_pen` verb—pen strokes now use canonical `create_shape { type: 'draw', props.segments }` events to stay aligned with TLDraw’s schema.
- [x] Introduced `src/lib/canvas-agent/contract/` so schemas, tool catalog, few-shots, shape prop normalization, and the base system prompt live in one shared package; server + client runners now import everything from this module.
- [x] Expanded the system prompt + few-shot set with starter-kit style composition guidance (poster/storyboard/sticky cluster/follow-up examples), reinforcing align/distribute/stack usage and pen strokes via canonical draw shapes.

---

## 7. How to Run and Judge Smoke Tests

Quick summary; details live in `docs/canvas-agent-smoke-tests.md`.

- **Setup**:
  - Use Node 22.18.0 (`fnm use 22.18.0`).
  - `npm run stack:restart` to bring up LiveKit, conductor, canvas agent, Next.js dev.
  - Open `/canvas` in the browser, `Connect` → `Request agent` before each test prompt.
- **Tests** (current set):
  - Test 1: Brutalist poster.
  - Test 2: Draw-heavy usage.
  - Test 3: Resize/rotate/align.
  - Test 4: Group/stack/reorder.
  - Test 5: Viewport move + follow-up.
  - Test 6: Todo/add_detail loop.
- **What to look for**:
  - No crash overlays or TLDraw validation errors.
  - Clear, intentional composition in screenshots (docs/examples/smoke-*.png).
  - Logs showing sane action counts and minimal dropped/deduped events.

---

## 8. Notes to Future Self (and Future LLMs)

- If you feel tempted to add more env knobs or “just one more” sanitizer:  
  - **Stop and ask**: can this be solved by improving the prompt, the tool catalog, or the examples instead?
- If posters are still ugly despite valid actions:
  - Revisit Phase B (composition guidance + few-shots) before touching runtime again.
- When in doubt about parity:
  - Re-read TLDraw’s `templates/agent` and fairy-related code for inspiration on *what they do not do*—their restraint is as important as their features.

---

## 9. Research Notes (2025-11-18)

> Keep this lightweight but explicit so the next run can skip redundant spelunking.

### TLDraw starter kit (templates/agent)

- **Prompt surface**: Agent capabilities are exposed via `PromptPartUtil` + `AgentActionUtil` arrays; the system prompt is short and references a JSON schema baked directly from each util. No extra env knobs besides model/provider selection. citeturn0search0
- **“Hands” contract**: Everything reduces to TLDraw-native actions (create/update/move/delete/align/stack/reorder/draw/etc.). Higher-level macros (clear board, apply hero preset) are implemented as `AgentActionUtil`s that expand into canonical verbs *on the client*, so the model always reasons with a concise verb surface. citeturn0search0
- **Prompt discipline**: Tool catalog + schema live side-by-side, and prompts are cached via the host UI—not via bespoke Supabase metadata. This keeps latency predictable (~2-3 s) because there is no extra dedupe layer between the model and TLDraw.

### Fairy worker (apps/dotcom/fairy-worker)

- Sits as a Cloudflare Worker with Durable Objects; maintains session context + streaming, but **does not** reshape or dedupe actions. It simply streams what the model emits (after schema validation) back to the editor. No extra environment switches except provider keys. citeturn0search3
- Durable Object approach shows how to get prompt caching + context persistence *without* coupling to Supabase queues—suggesting we should offload queue/screenshot retries outside of the steward loop.

### Branching-chat & sync templates

- Both templates prioritize **clear specialization** (AI front end vs. worker) and rely on TLDraw’s stock tooling. They avoid per-team knobs; instead they document how to extend shapes/tools when customizing. Implies we should resist adding bespoke env-driven behavior unless it maps back to standard TLDraw APIs. citeturn0search4turn0search5

### Critique of current harness

1. **Too many latent env knobs** (screenshot retries, prompt downscaling, dedupe switches). The starter kit never hides this complexity from the model; we should aim to converge on its leaner config surface.
2. **Server-side macro + dedupe logic** rewrites the action stream post hoc. TLDraw’s approach lets the model emit macros directly (`AgentActionUtil`), meaning no invisible transformations. We should port macros into the contract module and, where we must dedupe, emit explicit telemetry for the model (e.g., respond with `message` summarizing collisions) rather than silently rewriting.
3. **Latency budget**: Starter kit + fairy worker rely on prompt caching + Durable Objects to keep TTFB < ~2 s, whereas our screenshot gating and multi-pass sanitize loops routinely exceed 7 s. We need to either (a) prefetch screenshots before prompting or (b) restructure the conductor so screenshot capture runs in parallel with prompt assembly.

Next actions derived from this research:

- Collapse sanitize/dedupe into the shared contract (Phase C) so the steward merely validates + forwards.
- Mirror AgentActionUtil macros by moving our `apply_preset` expansion earlier (maybe even inside the shared contract) and exposing additional macros (clear_board, apply_theme, align_selection) so the model has TLDraw-native verbs identical to the starter kit.
- Use the prompt cache signature (docVersion + viewport + transcript) to warm Anthropic’s cache (already partially done) *and* skip rebuilding prompt parts when the screenshot is unchanged—matching the fairy worker’s Durable Object caching behavior.

---

## 10. Work Log (Rolling)

> Update this after every meaningful chunk of work. Keep entries short but specific.

- **2025-11-18 @ 14:35 PT** – Captured upstream research (starter kit, fairy worker, branching-chat, sync) and outlined de-bloating plan: move macro/validation into shared contract, drop server-side dedupe conversions, and slim env knob surface before the next smoke test pass.
- **2025-11-18 @ 15:05 PT** – Removed the runner’s “convert duplicate create → update” behavior; duplicates are now simply dropped with `[CanvasAgent:ActionDrops]` telemetry so the model sees the consequence in logs instead of hidden rewrites.
- **2025-11-18 @ 15:40 PT** – Introduced `loadCanvasAgentConfig()` + JSON override (`CANVAS_AGENT_CONFIG`) so screenshot/prompt/follow-up knobs live in one typed object, and updated the runner/logging to consume this shared config (thinner env surface, easier parity with the starter kit settings). Re-ran sanitize-focused Jest suites to confirm the refactor didn’t break parsing.
- **2025-11-18 @ 16:05 PT** – Restarted the full dev stack post-config refactor and prepped to resume smoke tests #3–#6; next steps are to open a fresh `/canvas` session, connect/request the agent through the UI, and capture PNG/log artifacts per test so we can judge visual quality (not just action count).
- **2025-11-18 @ 16:25 PT** – Ran Smoke Test #3 (resize/rotate/align) via `/api/steward/runCanvas`; screenshot saved to `docs/examples/smoke-2025-11-18-test3.png`. Result: **fail** — schema guard rejected every rotate/align action (missing `ids`/`axis` params), so the model only produced status `message` events and nothing changed on the canvas. Need to revisit the shared schema/examples so Haiku emits fully formed multi-shape verbs before repeating the test.
- **2025-11-18 @ 16:45 PT** – Re-aligned the `align` + `rotate` param schemas with TLDraw’s starter-kit format (accepting `shapeIds`/`alignment` + `degrees`) and convert them into our dispatcher’s canonical `{ ids, axis, mode }` / `{ ids, angle }`. Jest sanitize suite still passes. This should stop the schema guard from nuking every multi-shape command in Smoke Test #3; rerun pending.
- **2025-11-18 @ 17:05 PT** – Added `.passthrough()` to every action schema + restart so Anthropic’s structured stream can drip extra fields (`_type`, `intent`, blank anchors) without failing validation. Smoke Test #3 (attempt #4) finally streamed real `resize`, `rotate`, and `align` envelopes; screenshot saved to `docs/examples/smoke-2025-11-18-test3c.png`. Composition is still mediocre, but at least the steward now sees the intended verbs—ready to proceed to Test #4 once we judge this output.
- **2025-11-18 @ 17:25 PT** – Ran Smoke Test #4 (“group, stack, reorder”). Result: **fail** — Haiku kept streaming half-baked IDs (`""`, `"sticky-"`) before finishing the shape list, so schema guard dropped the groups/stack commands and only two actions (align fallback) survived (`actionCount: 2`). Screenshot at `docs/examples/smoke-2025-11-18-test4.png` shows no visible change. Need to explore teaching the model to emit complete ID arrays (maybe via tool catalog clarifications or by letting schema accept partially filled IDs until final chunk) before retrying.
- **2025-11-18 @ 17:35 PT** – Added a group/stack/reorder few-shot and explicitly told the model to finish IDs before sending multi-shape verbs (styleInstructions hints). Ready to retry Test #4 once the stack restarts so the prompt cache picks up the new examples.
- **2025-11-18 @ 17:50 PT** – Test #4 retried after prompt updates: the model streamed the full `group` ID list, but because it still emitted intermediate fragments first (e.g., `"copy-n"`, `"copy-note-"`) our schema validation trimmed the early partials. Final `stack`/`reorder` envelopes did arrive downstream, so TLDraw executed the right actions—PNG saved to `docs/examples/smoke-2025-11-18-test4b.png`. Remaining gap: align/stack verbs waste many chunks spelling IDs; consider buffering until the final form or relaxing the schema to accept partial IDs mid-stream.
- **2025-11-18 @ 18:05 PT** – Kicked off Smoke Test #5 (viewport move + follow-up). Haiku is streaming `set_viewport` bounds one field at a time, so schema guard drops the first few chunks until the full `{x,y,w,h}` object materializes. Need to improve the parser (buffer partial bounds) so Test #5 doesn’t stall before the actual pan + quiet label happen.
- **2025-11-18 @ 18:20 PT** – Refreshed `docs/canvas-agent-smoke-tests.md` with a pre-flight checklist (stack restart, fresh canvas, DevTools helpers), voice/chat requirements for specific tests, token-saving guidance, and an expanded test matrix (brand compliance, transcript continuation). Verification steps now include `[ActionDrops]` limits, TTFB capture, and visual QA notes so future runs measure both “eyes” and “hands” parity.
- **2025-11-18 @ 18:30 PT** – Reinforced “no server-side rewrites” rule (removed draw segment sanitizer) in AGENTS.md + this doc; still need to audit other mutation hotspots like `sanitizeActions`.
- **2025-11-18 @ 18:45 PT** – Attempted Test #1 (new fresh canvas) via API; run completed (`sessionId 1763449647062-zv850h`, `actionCount 18`) but TTFB still 8.3s and `[CanvasAgent:ActionDrops]` logged dozens of partial create chunks before each action settled. Need to rerun through chat UI for log completeness and keep tightening prompt guidance so streaming doesn’t require server buffering.
- **2025-11-18 @ 19:20 PT** – Smoke Test #1 rerun (fresh canvas, baseline/after PNGs). Actions streamed successfully (`Test 1 before/after` screenshots), but we still triggered the prompt via API due to chat input limitations—need to wire slash commands soon.
- **2025-11-18 @ 19:25 PT** – Smoke Test #2 rerun (draw pen). No TLDraw error modals; underline + zig-zag render in the after PNG. However `[CanvasAgent:ActionDrops]` still logs partial segment chunks while the model spells out the coordinates—prompt tweaks still needed.
- **2025-11-18 @ 18:30 PT** – Reaffirmed TLDraw parity rule: removed the server-side draw-segment sanitizer (fix prompt/examples instead) and captured in AGENTS.md + this doc that we should not post-process model actions. Still need to audit `sanitizeActions`/`normalizeRawAction` so they only enforce schema-level safety rather than rewriting content.
