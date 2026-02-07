# Fairy Intent Pipeline (Hybrid Fast/Slow Lane)

This document captures the new hybrid intent pipeline that powers the realtime smartboard stack.

## Goals
- One canonical intent schema for **all** inputs (voice, fairies, UI, transcript triggers).
- Two-lane execution:
  - **Fast lane** (immediate UI events) for viewport/layout tweaks.
  - **Slow lane** (LLM + stewards) for canvas edits and widget generation.
- Fairies remain UX/orchestration; stewards remain the execution engine.

## Core Types
- `FairyIntent` schema lives in `src/lib/fairy-intent/intent.ts`.
- Routing helper lives in `src/lib/fairy-intent/router.ts`.
  - Optional `contextProfile` allows a **spectrum** of context payloads: `glance`, `standard`, `deep`, `archive`.
  - Optional `spectrum` (0..1) can be sent to auto-pick a profile (0 = glance, 1 = archive).

## How to Dispatch an Intent
Use the existing queue endpoint:
```
POST /api/steward/runCanvas
{
  "room": "canvas-xyz",
  "task": "fairy.intent",
  "params": {
    "id": "<uuid>",
    "room": "canvas-xyz",
    "message": "focus on the selected notes",
    "source": "fairy",
    "selectionIds": ["shape:..."],
    "bounds": { "x": 0, "y": 0, "w": 100, "h": 100 },
    "contextProfile": "standard"
  }
}
```

The conductor will:
1) Route the intent with a fast Cerebras model when available.
2) Dispatch fast-lane UI events (if applicable).
3) Execute the slow-lane steward task (canvas or widget).

## Fast Lane
Fast-lane actions are dispatched via tool calls:
- Tool: `dispatch_dom_event`
- Example: `{ event: 'tldraw:canvas_focus', detail: { target: 'selected' } }`

Currently supported events:
- `tldraw:canvas_focus`
- `tldraw:canvas_zoom_all`
- `tldraw:toggleGrid`
- `tldraw:arrangeGrid` (supports `componentTypes` / `componentIds`)
- `tldraw:arrangeSidebar` (supports `side`, `componentTypes`, `componentIds`)
- `tldraw:arrangeSpeaker` (speaker spotlight view; supports `speakerIdentity`/`speakerComponentId`, plus sidebar config)
- `tldraw:applyViewPreset` (presets: `gallery`, `speaker`, `sidebar`, `presenter`, `canvas`)

## Slow Lane Routing Targets
- `canvas` → `canvas.agent_prompt`
- `scorecard` → creates a `DebateScorecard` component + runs `scorecard.run`
- `infographic` → creates `InfographicWidget` + updates with `instruction`
- `kanban` → creates `LinearKanbanBoard` + updates with `instruction`
- `summary` → generates a CRM-ready summary + drops it into Context Documents
- `bundle` → fan-out to multiple actions in one request

Summary output is delivered via a `dispatch_dom_event` tool call:
- `event: "context:document-added"` with `{ title, content, type: "markdown" }`
- Also updates/creates a `MeetingSummaryWidget` with structured summary fields.

Optional memory sink:
- Set `SUMMARY_MEMORY_MCP_TOOL` (env) or send `metadata.summaryMcpTool` / `metadata.crmToolName` to auto-wire a memory MCP tool.
- `SUMMARY_MEMORY_AUTO_SEND=true` or `metadata.summaryAutoSend=true` to auto-send summaries.
- Optional targeting: `SUMMARY_MEMORY_MCP_COLLECTION`, `SUMMARY_MEMORY_MCP_INDEX`, `SUMMARY_MEMORY_MCP_NAMESPACE` (or `metadata.memoryCollection|memoryIndex|memoryNamespace`) to route into the correct vector store target.

When using `bundle`, the router returns an `actions` array, e.g.:
```
{ "kind": "bundle", "actions": [{ "kind": "infographic" }, { "kind": "kanban" }, { "kind": "summary" }] }
```

## Router Configuration
- Uses Cerebras via `@cerebras/cerebras_cloud_sdk`
- Model env: `FAIRY_ROUTER_FAST_MODEL` (fallback to `FAST_STEWARD_MODEL`)
- If Cerebras is unavailable, the router safely defaults to `canvas`.
 - Router may emit `contextProfile` to control how much context is bundled downstream.

## Client Agent Gate
- `NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED=false` keeps the local fairy agent off.
- `NEXT_PUBLIC_FAIRY_ENABLED=true` can stay on for UI only.

## Current Entry Points
- `FairyPromptPanel` now dispatches `fairy.intent` directly.
- Existing voice agent paths still work (`canvas.agent_prompt`, `scorecard.run`, etc.).

## Context Bundles
Client-side intent dispatch can attach a context bundle via `metadata`:
- Hook: `useFairyContextBundle` in `src/lib/fairy-context/use-fairy-context-bundle.ts`
- Includes recent transcript, documents, widget snapshots, and selected custom shapes.
 - `contextProfile` tunes size/latency tradeoffs (glance → archive).

## Dedupe (Optional)
To avoid duplicate intents from noisy transcript/voice streams:
- `FAIRY_INTENT_DEDUPE_MS` (default `1200`) suppresses identical intents inside the window.
- `FAIRY_INTENT_DEDUPE_MAX` caps the in-memory fingerprint cache (default `200`).

## Next Steps
1) **Voice Agent Integration**: emit `fairy.intent` as the default dispatch (with LLM routing on conductor).
2) **Fairy LiveKit Bridge**: intercept `agent_prompt` and route through intent pipeline (or emit intents directly).
3) **Scene/Viewport Presets**: add LiveKit layout modes + canvas focus presets to the fast lane.
4) **Context Providers**: modularize context assembly (documents, attachments, widget history, etc.).
