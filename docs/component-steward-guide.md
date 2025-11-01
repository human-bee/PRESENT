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

*Last updated: 2025-11-01*
