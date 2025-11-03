# Component & Steward Integration Guide (Draft)

> Working playbook for building TLDraw widgets and steward workflows that collaborate with the Voice + Canvas Agents. This doc focuses on contracts and tooling rather than UI polish.

---

## 1. Architecture Crash Course

- **Voice Agent (Realtime):** normalizes user intent, reserves component IDs (`reserve_component`), issues updates, and keeps latency low via lossy `update_component`.
- **Conductor:** hands off long-running tasks to stewards and streams status back to the browser.
- **Canvas Agent (Server):** now ingesting `shape.props.state` (bounded by `CANVAS_AGENT_SHAPE_STATE_LIMIT`, default 4 KB) so the model has the latest runtime state before planning actions.
- **Browser (ToolDispatcher + TLDraw bridge):** applies patches, exposes metrics, and keeps the `ComponentRegistry` as a local source of truth.

Keep the voice agent lean; heavy analysis or multi-step planning should run via the Canvas Agent/Stewards.

---

## 2. Component Contract (Client-Side)

1. **Registration:** call `useComponentRegistration(messageId, type, props, contextKey, handleAIUpdate)` during mount. The hook wires your component into the registry and exposes the latest props to other surfaces.
2. **Runtime state:** use the injected `state` (from TLDraw shape) as the source of truth. When you mutate local state, mirror the change by calling the injected `updateState` helper so other clients stay in sync.
3. **Patches:** `handleAIUpdate` should be idempotent and tolerant of partial payloads. Coerce `duration`, `timeLeft`, etc. – the dispatcher now does most normalization, but components should still guard against missing fields.
4. **Deterministic IDs:** accept either a provided `__custom_message_id` or derive a fallback, but avoid random IDs – the voice agent uses the ID to resolve future updates.
5. **Perf ceiling:** keep renders under ~10 ms; expensive recomputations should live inside `useMemo`/`useCallback` or be deferred until interaction.

---

## 3. Steward Responsibilities (Server-Side)

- **Reserve before create:** call `reserve_component` with `type`, `intentId`, `messageId`, and optional `slot` whenever you plan to emit a component. The browser ledger eliminates race conditions between multiple agents.
- **Resolve smartly:** when updating an existing component from steward context, prefer `resolve_component` (intent/slot/type) instead of guessing the last created ID.
- **Validation:** sanitize input (minutes, URLs, etc.) before calling downstream tools. Emit user-facing errors via `agent:chat` rather than failing silently.
- **Streaming etiquette:** long tasks should stream interim status (`analysis_started`, `analysis_complete`) so the browser can surface progress.

---

## 4. Canvas Agent Prompt Context

- `buildPromptParts` now merges shape runtime state (bounded, with truncation metadata) into the prompt. Keep state objects small; trim transient fields, logs, or large arrays before calling `updateState`.
- If your component needs additional context, store a concise summary in `shape.props.state` instead of bloating props.
- Monitor `shapeStateStats` (logged in prompt budget) to ensure no steward/component is flooding the prompt.

---

## 5. Diagnostics & Performance

- **Runtime flag:** set `NEXT_PUBLIC_TOOL_DISPATCHER_METRICS=true` (or `window.__presentDispatcherMetrics = true`) to log `[ToolDispatcher][metrics]` entries with `tSend`, `tArrive`, `tPaint` per component.
- **Playwright perf spec:** `npx playwright test tests/timer-perf.e2e.spec.ts` validates create/update latency for timers. Use it as a template for other widgets.
- **Warnings:** dev builds now warn on duplicate registrations or callback swaps (`ComponentRegistry`). Investigate repeated messages – they often signal double mounts or mismatched IDs.

---

## 6. Testing Playbook

1. **Manual smoke:** run `npm run stack:start`, open `/canvas`, connect LiveKit, and drive the component via voice + transcript UI.
2. **Automated perf:** run the Playwright spec above on every branch that touches dispatcher/agent plumbing.
3. **Future coverage (TODO):** add component-specific Playwright specs (e.g., debate scorecard) and lightweight unit tests for steward resolvers.

---

## 7. Quick Checklist

- [ ] Reserve component intent before creation.
- [ ] Emit `updateState` for any local runtime change.
- [ ] Keep `shape.props.state` ≤ `CANVAS_AGENT_SHAPE_STATE_LIMIT` (default 4 KB).
- [ ] Verify dispatcher metrics stay under latency budget (<1.5 s send→paint for create/update).
- [ ] Document any new steward/component pairing in this guide when shipping.
- [ ] If the flow depends on MCP, verify servers in `/mcp-config` and confirm `mcp_*` tools appear in the Capability Inspector.

---

## 8. MCP Tooling & Agent SDK Integration

> TL;DR – the `/mcp-config` UI feeds `EnhancedMcpProvider`, which syncs discovered tools into the system registry. Stewards and the Voice Agent can then invoke them via `mcp_*` tools.

1. **Register servers (UI):**
   - Visit `/mcp-config`, add HTTP/SSE endpoints, and click **Verify & Map**. Configs persist in `localStorage` under `mcp-servers`.
   - The `McpStatusIndicator` should show each server as *Connected*.

2. **Bridge to the browser:**
   - `EnhancedMcpProvider` (mounted in `/canvas`) reads the saved configs, instantiates clients, and exposes `window.callMcpTool(name, params)`.
   - It also emits `custom:mcpToolResponse` events consumed by `useToolRunner`’s `runMcpTool` helper.

3. **Expose tools to agents:**
   - `syncMcpToolsToRegistry` (see `src/lib/system-registry.ts`) promotes discovered MCP tools into the shared capability registry.
   - Tools appear twice: raw (`mcp_weather`) and mapped (`youtube_search`, etc.) when a shortcut exists.
   - Voice Agent + stewards can call `mcp_*` tools directly. Example in `useToolRunner`: if the tool name starts with `mcp_`, the dispatcher automatically forwards the request to the window bridge.

4. **Agent SDK usage:**
   - Inside a steward, define tools with `llm.tool({ name: 'mcp_weather', ... execute: async args => { ... } })` or pass through via `llm.mcpTool('weather')` helper if you use the Agents SDK sugar.
   - Remember to include MCP tools in the steward’s instructions/manifest so the model knows they exist (`systemRegistry.getToolRouting` resolves mappings at runtime).

5. **User-entered tools:**
   - New servers added by users are available immediately to both browser-side helpers and server-side stewards because the registry sync runs on every connect.
   - Encourage users to provide descriptive names; these surface in logs and the Capability Inspector (`/canvas` → “MCP Tools” panel).

6. **Debugging:**
   - Enable `NEXT_PUBLIC_TOOL_DISPATCHER_METRICS=true` and watch for `[ToolDispatcher][mcp]` logs.
   - Check `window.__custom_mcp_tools` in the console to see the current MCP tool catalog.
   - If a steward call fails, inspect `logs/agent-conductor.log` for the tool payload and the MCP server’s response.

*Last updated: 2025-11-01*

---

## 9. Example: Debate Scorecard Steward

- **Schema** – `src/lib/agents/debate-scorecard-schema.ts` holds the shared Zod models for claims, players, achievements, and timeline events.
- **Steward** – `src/lib/agents/debate-judge.ts` now exposes `debateScorecardSteward` with `get_current_scorecard`, `get_context`, and `commit_scorecard` tools.
- **UI Component** – `src/components/ui/productivity/debate-scorecard.tsx` renders the scoreboard (scores, momentum, achievements, live timeline) and registers via `useComponentRegistration`.
- **Voice Agent** – `src/lib/agents/realtime/voice-agent.ts` reserves/creates the scorecard component and dispatches `scorecard.run` jobs to the conductor when debate intents are detected.
- **Conductor Routing** – `src/lib/agents/conductor/index.ts` handles `scorecard.*` tasks and forwards them to `runDebateScorecardSteward`.

### Lessons from the scorecard rollout

- **Let the steward finish the job.** Once the voice agent calls `dispatch_to_conductor({ task: 'scorecard.run', ... })`, bail out of the `update_component` branch. Returning `{ status: 'REDIRECTED' }` keeps the voice agent from spamming literal `update_component` calls while the steward is mid-run.
- **Broadcast every commit.** The steward must POST its final state through `/api/steward/commit`; that LiveKit broadcast is what keeps every browser in sync. Local `ComponentRegistry` updates alone are not enough.
- **Design for expansion, not aspect ratios.** The scorecard originally lived inside a fixed 16×9 frame, which clipped long ledgers/timelines. A flexible two-column shell (sidebar + scrollable main pane) handled large steward patches without layout hacks.
- **Mirror LiveKit updates into the TLDraw store.** After `ComponentRegistry.update`, emit a `custom:showComponent` + `tldraw:merge_component_state` so the TLDraw shape, transcript preview, and registry stay aligned.
- **Stress-test with synthetic patches.** Before relying on the steward pipeline, fire a manual `custom:showComponent` event containing a heavy payload (multiple claims, fact checks, timeline items). It’s a quick way to surface layout issues or schema mismatches.

Use this as a reference when cloning the steward pattern for other multi-surface widgets.

#### Evidence search & citations (new in November 2025)

- `search_evidence` (`src/lib/agents/debate-judge.ts`) is the canonical tool for live web lookups. It wraps `performWebSearch` (`src/lib/agents/tools/web-search.ts`) which hits OpenAI Responses with the built-in `web_search` capability and normalises hits into `{ id, title, url, snippet, publishedAt?, source? }`.
- We inject the tool into the steward manifest (`tools: [get_current_scorecard, get_context, search_evidence, commit_scorecard]`) and require the steward to call it before switching a claim from `CHECKING` → `VERIFIED`/`REFUTED`.
- Returned hits should be copied into both `claim.factChecks[].evidenceRefs` and the global `sources[]` array so the UI can display a bibliography. Each entry already includes stable `source-${sha1(url)}` IDs—reuse them to avoid dupes.
- When merging optimistic concurrency conflicts we reconcile `sources` and `factChecks` by ID (see `mergeById` helpers). Any new steward should follow this pattern so citations survive retries.
- The helper will throw if the Responses API rejects the payload. Keep prompts JSON-only (no markdown) and avoid unsupported model options such as `reasoning.effort` unless the target model documents them.
- Smoke-testing checklist for any new evidence-driven steward:
  1. Trigger the steward on a fresh `/canvas` board.
  2. Confirm `🔍 [Steward] search_evidence` logs appear with non-zero `hits`.
  3. Reload the board; `sources[]` should persist and the Sources tab should show the recorded URLs/snippets.
  4. Verify pending-verification IDs clear when a claim is marked `VERIFIED`.
