# Code Organization Overview

## UI Directory Structure (After 2025 Refactor)

- `src/components/ui/ai/`: AI-specific widgets (e.g., `ai-image-generator`).
- `src/components/ui/canvas/`: TLDraw canvas shell and related hooks/utilities.
  - `canvas-space.tsx`: main canvas container (kept under 300 LOC target; delegates to hooks).
  - `hooks/`: feature hooks (`useCanvasComponentStore`, `useCanvasRehydration`, etc.).
  - `components/` & `utils/`: extracted UI fragments and helpers (e.g., drag/drop, onboarding).
- `src/components/ui/documents/`: document editor/viewer + markdown renderer.
- `src/components/ui/livekit/`: LiveKit room connector, toolbar, participant tiles, automation helpers.
- `src/components/ui/messaging/`: chat threads, message components, thread UI.
- `src/components/ui/productivity/`: timers, debate scorecard, Linear board.
- `src/components/ui/research/`: research panel and renderers.
- `src/components/ui/shared/`: reusable UI primitives (buttons, cards, avatar, toolbox, etc.).
- `src/components/ui/tldraw/`: TLDraw shapes, canvas integration, persistence wrappers.
- `src/components/ui/youtube/`: YouTube embed/search/list components.
- `src/components/ui/diagnostics/`, `integrations/`, etc. for specialized features.

These feature buckets keep TLDraw-specific logic out of core agent code, enable modular refactors, and align with future multi-agent responsibilities.

## Feature Folder Snapshots

```text
src/components/ui/livekit/
  components/
    RoomConnectorUI.tsx
  hooks/
    index.ts
    useAgentDispatch.ts
    useLivekitConnection.ts
    useRoomEvents.ts
  utils/
    constants.ts
    index.ts
```

```text
src/components/ui/tldraw/
  components/
    CollaborationLoadingOverlay.tsx
  hooks/
    index.ts
    useCanvasEventHandlers.ts
    useCollaborationSession.ts
    useEditorReady.ts
    usePinnedShapes.ts
    useTldrawEditorBridge.ts
  utils/
    canvas-creation-handlers.ts
    canvas-navigation-handlers.ts
    canvas-selection-handlers.ts
    mermaid-bridge.ts
    pinned-shapes.ts
    ui-state-handlers.ts
    window-listeners.ts
```

```text
src/components/ui/presentation/
  presentation-deck.tsx
  hooks/
    useDeckHotkeys.ts
    useOverlayState.ts
    useSlideNavigation.ts
  components/
    ControlsToolbar.tsx
    OverlayLayer.tsx
    SlideNavigator.tsx
  utils/
    deckTransforms.ts
    keyBindings.ts
```

```text
src/components/ui/documents/
  markdown-viewer-editable.tsx
  hooks/
    useDiffRenderer.ts
    useMarkdownPipeline.ts
  components/
    DiffView.tsx
    MarkdownHeader.tsx
    MarkdownPreview.tsx
  utils/
    parserOptions.ts
    sanitizeSchema.ts
    uiShortcuts.ts
```

Each folder ships with barrel exports (`index.ts`) for hooks/components/utils so consumers import stable public APIs instead of deep paths.

## Canvas Hooks Pattern

The canvas entrypoint now delegates to hooks:

- `useCanvasComponentStore`: centralizes shape/component bookkeeping and system registry updates.
- `useCanvasRehydration`: restores shapes/components on load or document change.
- `useCanvasThreadReset`: clears canvas state when switching threads.
- `useCanvasEvents`: handles `custom:showComponent`, draining queued components, and dispatching `ui_mount` events.

Each hook lives under `src/components/ui/canvas/hooks/` and exposes typed APIs for reuse.

## Refactor Results (October 2025)

### Refactor Snapshot (2025)

| Surface | Before LOC | After LOC | Notes |
| --- | ---: | ---: | --- |
| `livekit-room-connector.tsx` | 1,220 | 94 | Pure orchestrator — delegates to connection/agent hooks and `RoomConnectorUI`. |
| `tldraw-with-collaboration.tsx` | 1,254 | 137 | Orchestrator composes session hooks, bridge, and overlay; no window state. |
| `useCanvasEventHandlers.ts` | 640+ | 66 | Now only wires handler maps from `utils/` and mermaid bridge. |
| `tldraw-canvas.tsx` (Wave 2) | 1,064 | 189 | Orchestrator composes extracted hooks, HUD/toolbar/rulers, delegates side-effects to hooks. |
| `tool-dispatcher.tsx` (Wave 2) | 1,015 | 43 | Thin orchestrator wiring typed registry/queue/runner hooks; UI is fully presentational. |

Our guardrail remains **≤300 LOC** per orchestrator and ≤160 LOC per hook. When a file approaches those limits, extract helpers immediately.

### Patterns (Reinforced)

- Hooks own side-effects (network, timers, subscriptions) and expose typed actions/state.
- Orchestrators compose hooks and wire props; they never touch `window` or mutate shared refs directly.
- Presentational components stay pure and stateless; overlays render from explicit status (`'connecting' | 'syncing' | …`).
- Barrel exports define the module surface area (`hooks/index.ts`, `components/index.ts`, `utils/index.ts`). Import barrels, not deep paths.

### Mini ADR — TLDraw/LiveKit Ownership

**Context.** TLDraw integrations previously stuffed LiveKit bus wiring, shape transforms, and UI effects into a single monolith (>1,200 LOC). That made event cleanup brittle and leaked the raw editor onto `window` for other modules to fish out.

**Decision.** Push all editor side-effects into hooks/utilities:

1. `useTldrawEditorBridge` exposes a typed bridge (ID + dispatcher) and dispatches legacy `custom:rehydrateComponents` events for compatibility — no raw editor on globals.
2. `useCanvasEventHandlers` composes handler maps from `utils/` modules (`canvas-creation|selection|ui-state`) so each map remains pure and testable.
3. `CollaborationLoadingOverlay` reflects `useCollaborationSession.status`, keeping UI state declarative.

The same pattern applies to LiveKit: `useLivekitConnection` owns token fetch + connection, `useAgentDispatch` handles tool requests, and the orchestrator remains a <100 LOC wiring layer.

**Consequences.**

- Tests can target pure utilities (`pinned-shapes`, `mermaid-bridge`, `window-listeners`).
- TLDraw snapshots/broadcasters receive the editor instance via props instead of digging through globals, shrinking cross-module coupling.
- Adding new canvas events means writing a handler factory in `utils/` and plugging it into the hook — zero orchestrator churn.

### Wave 2 Module Diagrams

#### TLDraw Canvas

```
TldrawCanvas (orchestrator)
 ├─ hooks/
 │   ├─ useCanvasStore          (selectors + derived state)
 │   ├─ useCanvasShortcuts      (key bindings, memoised handlers)
 │   ├─ useRulersAndGrid        (ruler/grid math, visibility)
 │   ├─ useExportImport         (PNG/SVG/JSON export + import)
 │   └─ useUrlSync              (optional URL state sync)
 ├─ components/
 │   ├─ CanvasToolbar
 │   ├─ CanvasHUD
 │   ├─ Rulers
 │   └─ GridLayer
 └─ utils/
     ├─ canvasMath              (snap/scale helpers; unit tested)
     ├─ exporters               (pure transforms; unit tested)
     ├─ urlState                (parse/serialize)
     └─ constants/shapeUtils    (constructor exports only)
```

#### Tool Dispatcher

```
ToolDispatcher (orchestrator)
 ├─ hooks/
 │   ├─ useToolRegistry         (typed descriptors, barrel exported)
 │   ├─ useToolEvents           (bus subscribe/emit, returns unsubscribe)
 │   ├─ useToolQueue            (state machine via reducer; tested)
 │   └─ useToolRunner           (executes tool with timeout/log streaming)
 ├─ components/
 │   ├─ ToolList                (pure picker UI)
 │   ├─ JobCard                 (status)
 │   └─ JobLog                  (stream output)
 └─ utils/
     ├─ toolTypes               (enums + shared types)
     ├─ queueReducer            (pure reducer; jest)
     ├─ resultNormalizers       (idempotent transforms; jest)
     └─ constants               (topics/timeouts)
```

Tests now live alongside the pure modules:

- `src/components/ui/tldraw/canvas/utils/{canvasMath,exporters}.test.ts`
- `src/components/tool-dispatcher/utils/{queueReducer,resultNormalizers}.test.ts`

### Remaining Modularization Targets

- `src/components/ui/presentation/presentation-deck.tsx` (~820 LOC)
- `src/components/ui/documents/markdown-viewer-editable.tsx` (~818 LOC)
- `src/components/ui/productivity/action-item-tracker.tsx` (~700-900 LOC)
