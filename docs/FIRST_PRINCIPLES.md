# First Principles

> If you're about to add "just one more heuristic," don't. Make a steward or remove the feature.

## 1) One agent hears; others think

* **Voice Agent (Realtime)**: ears + intent + **two** UI tools.
* **Stewards (Agents SDK)**: own domain logic; return **one** artifact or patch.
* **Conductor**: routes; doesn't think.

## 2) Verbatim > "smart"

* Componenets are **fully authored** by the steward and applied **verbatim**.
* No normalization passes. No keyword lists. No hidden "fixers."

## 3) Two UI tools in production

* `create_component({ type, spec })`
* `update_component({ componentId, patch })`
  Everything else is either a handoff to a steward or a TLDraw DOM event.

## 4) One LLM call per trigger

* No always-on decision loops.
* Realtime function call → execute → return `function_call_output` → continue.

## 5) Source of truth (Supabase)

* **Transcripts**: `public.canvas_sessions.transcript`.
* **Steward i.e Flowchart doc**: `public.canvases.document` `{ doc, format, version }`.
* **etc**

## 6) Typed everything

* Zod for tool params and output shapes.
* JSON contracts must be explicit. Ambiguity is a bug.

## 7) Small, boring files

* ≤200 LoC per file where feasible.
* Prefer "extract helper" over "scroll forever."

## 8) Hosted tools over homebrew

* Use **OpenAI Responses API** hosted tools (web/file search, MCP) instead of writing clients.
* The browser does UI, not crawling.

## 9) Debounce reality

* Stewards run on **debounced** transcript windows (2–4s under load).
* Never stream each sentence into a steward.

## 10) Observability before cleverness

* Tracing on by default (fetch → reason → commit).
* Log `prevVersion → nextVersion` for all doc commits.
* If we can't see it, we can't fix it.

---

## Anti-patterns (red flags)

* **Browser as agent:** ToolDispatcher growing new "tools," parsing transcript, or making network calls.
* **Heuristic rat's nest:** keyword routing, hand-rolled intent funnels.
* **Doc diffs:** partial mermaid edits; "normalizers"; "magic fixers."
* **Duplicate prompts:** multiple instruction sources feeding the same model.
* **Silent failures:** no `tool_error`, no trace, no log.

---

## How to add a new capability (the only acceptable way)

1. **Define the output** (one UI component or one patch).
2. **Create a steward** (Agents SDK + Responses tools + Tailored MCPs).
3. **Expose a single handoff** in the Conductor.
4. **Keep the browser dumb** (still only two UI tools).
5. **Write 2 tests**: one happy path, one malformed output (should raise `tool_error` or rollback).
6. **Trace it** (ensure spans show fetch → reason → commit).

---

## PR checklist (non-negotiable)

* [ ] No keyword/heuristic routing added.
* [ ] Steward produces 2 Streamed Structured Outputs: 1 to update component and 1 short plain-text summary to inform voice agent and tool dispatcher.
* [ ] All new params are zod-typed.
* [ ] Files stay ≤200 LoC (or explain why).
* [ ] Tracing is visible; errors produce `tool_error`.
* [ ] Notes in PR for potential updates to Docs (i.e. this file + `AGENTS.md`).

---

## FAQ (short, sharp)

**Q: Why not let the voice agent "just" generate mermaid?**
A: Because ownership and retries. The steward holds the doc, handles version conflicts, and emits exactly one artifact. Cleaner invariants, fewer surprises.
**Q: Can I add a quick heuristic for a demo?**
A: No. Make a steward or skip the feature. Demo debt is still debt.
**Q: What's the core architecture in one sentence?**
A: Voice hears + calls 2 tools. Stewards think + write full artifacts. Browser executes + renders verbatim. Supabase remembers. Everything else is noise.

## Architecture Overview

> The multi-agent system enables real-time speech-to-UI interactions where agents can:
>
> * Initialize custom components (timers, weather widgets, debate scorecards)
> * Create and manipulate TLDraw shapes (mermaid diagrams, flowcharts, annotations)
> * Control canvas view (pan, zoom, focus on specific areas)

### Voice Agent (Realtime API)

* One LiveKit Cloud Agent Per User
* Listens to LiveKit room audio and transcribes speech
* Makes function calls to exactly **two** UI tools via LiveKit data channel
* May hand off server-side work to the Conductor
* Follows [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) patterns

### Conductor Agent (Agents SDK)

* Tiny router that delegates to steward subagents via handoffs
* No business logic - pure routing
* Uses [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/) patterns

### Stewards (Agents SDK)

* Domain owners (e.g., Flowchart Steward, YouTube Steward, Canvas Steward)
* Read context from Supabase
* Produce **complete artifacts** (or diffs when architected accordingly)
* Emit one UI patch or component creation
* Follow [Responses API](https://platform.openai.com/docs/api-reference/responses) patterns

### Browser ToolDispatcher (React)

* Bridge, not an agent
* Executes `create_component` and `update_component`
* Sends `tool_result`/`tool_error` back to agents
* Dispatches TLDraw DOM events when needed

### Supabase

* Source of truth for transcripts and component docs
* Format: `{ doc, format, version }`
