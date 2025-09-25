# Canvas Steward Playbook

This playbook captures the workflow we used to wire the Mermaid flowchart steward into the canvas. Follow it as a template when cloning the pattern for other canvas components (tables, dashboards, live transcripts, etc.).

---

## High-Level Loop

```
User speaks/types → Voice Agent → ToolDispatcher → Steward → Supabase → LiveKit ui_update → Canvas component
```

Key repos paths:
- Voice agent: `src/lib/agents/realtime/voice-agent.ts`
- Steward template: `src/lib/agents/subagents/flowchart-steward.ts`
- Supabase helpers: `src/lib/agents/shared/supabase-context.ts`
- Tool dispatcher + canvas bridge: `src/components/tool-dispatcher.tsx`
- TLDraw mermaid component: `src/components/ui/tldraw-canvas.tsx`
- Transcript sidebar: `src/components/ui/message-thread-collapsible.tsx`

Run the stack with:
```bash
npm run agent:realtime
npm run agent:conductor
npm run dev
```

---

## 1. Component Creation & Update Contract

1. **Expose a custom component**
   - Build the React surface you want to hydrate (e.g., Mermaid stream, scorecard, timeline).
   - Register it with the component registry so the dispatcher can `create_component` / `update_component` against it.
   - Example registration lives in `src/components/ui/tldraw-with-collaboration.tsx` (Mermaid shape) and `src/lib/component-registry.ts`.

2. **Implement `create_component` mapping**
   - In steward mode we only allow `create_component`/`update_component` (ToolDispatcher, lines ~205–320).
   - Constrain the spec so the steward can only set safe props. For Mermaid we keep `mermaidText` + sizing.

3. **Implement `update_component` mapping**
   - ToolDispatcher forwards patches to `ComponentRegistry.update`.
   - Custom shapes can capture patch callbacks; see `MermaidStreamRenderer` for compile status handling.

> Tip: keep component props serializable and < 20k characters to fit LiveKit/Supabase payload budgets.

---

## 2. Making Agents Aware

1. **Voice Agent**
   - Instructions live in `voice-agent.ts` (`instructions` string).
   - Realtime event hooks:
     - `input_speech_transcription_completed`: broadcasts decisions after a debounce.
     - `response_function_call_completed`: forwards tool calls to browser.
     - **Manual text bridge** (added for keyboard input): we create a `llm.ChatMessage` and re-use the same debounce.

2. **Steward Agent**
   - Template resides in `flowchart-steward.ts`.
   - Tools pattern:
     ```ts
     const get_current_doc = tool(...)          // fetch component state
     const get_context = tool(...)              // fetch latest transcript window
     const commit_doc = tool(...)               // optimistic commit + LiveKit broadcast
     ```
   - Build instructions to (a) fetch state/context, (b) synthesize full doc, (c) commit.
   - Model choice is `gpt-5-mini`, but you can swap. Responses API follwong OpenAI's Agent JS SDK.

3. **Conductor**
   - The `/api/steward/run` endpoint simply calls `runFlowchartSteward`. When adding new stewards, export additional `runSomethingSteward` helpers and register handoffs inside the conductor worker.

---

## 3. Persistence Strategy

- **Flowchart content** is stored in the `canvases` table under `document.components[componentId]`. `commitFlowchartDoc` handles optimistic concurrency and keeps an in-memory fallback (helps while Supabase latency catches up).
- **Transcripts** live in `canvas_sessions.transcript`. `useSessionSync` appends lines every time the bus broadcasts `transcription`.
- **Local caches**:
  - `appendTranscriptCache` ensures the steward can access fresh lines even before Supabase writes flush.
  - `message-thread-collapsible.tsx` mirrors manual sends into the transcript list immediately.

When cloning this pattern tailor both `get*` and `commit*` helpers in `src/lib/agents/shared/supabase-context.ts` for your component schema.

---

## 4. Trigger Flow

1. User speech is transcribed by OpenAI → voice agent publishes `decision` (`summary: 'steward_trigger'`). Manual typed text now shares the same debounce.
2. ToolDispatcher listens for `decision` events (lines ~720–780) and schedules `/api/steward/run` once the mermaid shape exists.
3. Steward completes task, `commit_flowchart` POSTs `/api/steward/commit` → LiveKit emits `ui_update` → TLDraw shape updates.
4. Canvas logs show every step (`[ToolDispatcher]`, `[Canvas][ui_update]`, `[Steward]` etc.).

> Tip: watch `logs/agent-realtime.log` for `decision` timestamps and tool call outputs; check browser console for `[Canvas][ui_update]` and TLDraw warnings like “Mermaid error – keeping last good render”.

---

## 5. Testing & Observability

- **Playwright** regression (`tests/flowchart.e2e.spec.ts`) creates a mermaid shape, calls `/api/steward/commit`, and asserts TLDraw updates the SVG.
- **Logs**:
  - `logs/agent-realtime.log`: agent job state, tool call outputs, manual text bridge, steward debounce.
  - `logs/agent-conductor.log`: steward start/finish, preview of `finalOutput`.
  - Browser console: all `ToolDispatcher` events and sanitised mermaid compile logs.

When adding a new steward, copy the Playwright test, adjust selectors/tool payloads, and add assertions for the expected UI state.

---

## 6. Optimization & Guardrails

- **Sanitize input**: `MermaidStreamRenderer.sanitizeInput` removes `%%{init}%%` directives and limits size to 8k. Replicate similar guards for other renderers (charts, HTML, etc.).
- **Keep last good render**: fallback to previous SVG when parsing fails, surface errors via compile state.
- **Debounce**: the 2.5 s window prevents hammering the steward on every token. Tune per component.
- **Concurrency**: `commitFlowchartDoc` retries once on conflict; scale this if multiple stewards may write the same doc simultaneously.
- **Decision granularity**: If the voice agent should trigger different stewards, adjust the `summary` and add routing logic in ToolDispatcher.

---

## 7. Extending to New Components

1. **Define the component surface** (React + TLDraw, chart widget, etc.). Save props to Supabase in a structured shape.
2. **Expose tool contract** (ToolDispatcher create/update) that maps steward patch → component props.
3. **Write the steward agent**:
   - Fetch current state + transcript.
   - Synthesize a deterministic artifact (entire doc each turn).
   - Commit with `commit_*` helper broadcast.
4. **Hook decision pipeline** if using the voice agent. If the component should respond to specific intents, add classification logic or tune instructions.
5. **Test** with Playwright or jest + TLDraw harnesses. Capture network events, final DOM state, and mermaid (or equivalent) output.

Use this doc as a living template—copy sections into new steward folders (e.g., `docs/stewards/<component>.md`) and adjust steps/commands accordingly.

---

## Quick Reference Checklist

- [ ] Component registered in `ComponentRegistry` and ToolDispatcher mapping added.
- [ ] Steward agent template cloned with `get_current_*`, `get_context`, `commit_*` tools.
- [ ] Supabase helpers updated for new component schema.
- [ ] Voice agent instructions mention new tool/intent; debounce triggers verified for speech and manual text.
- [ ] `/api/steward/run` route points to new `run*Steward` helper (if needed).
- [ ] LiveKit broadcast (ui_update) decoded by the component.
- [ ] Tests cover create + update path.
- [ ] Logging surfaces compile/render errors clearly.

Happy stewarding! Add notes or variants to this file as you build more canvas-native agents.
