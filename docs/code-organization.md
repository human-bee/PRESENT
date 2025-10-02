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

## Canvas Hooks Pattern

The canvas entrypoint now delegates to hooks:

- `useCanvasComponentStore`: centralizes shape/component bookkeeping and system registry updates.
- `useCanvasRehydration`: restores shapes/components on load or document change.
- `useCanvasThreadReset`: clears canvas state when switching threads.
- `useCanvasEvents`: handles `custom:showComponent`, draining queued components, and dispatching `ui_mount` events.

Each hook lives under `src/components/ui/canvas/hooks/` and exposes typed APIs for reuse.

## Refactor Results (October 2025)

### Completed Refactors ✅

#### 1. `tldraw-with-collaboration.tsx` (1254 LOC → 161 LOC | 87% reduction)

Extracted into modular, reusable pieces:

**Hooks** (`src/components/ui/tldraw/hooks/`):
- `useCollaborationRole.ts` - Detects user role from LiveKit metadata
- `useTLDrawSync.ts` - Configures TLDraw sync with demo server
- `usePinnedShapes.ts` - Manages viewport-pinned shapes
- `useCanvasEventHandlers.ts` - Registers all canvas control events (mermaid, shapes, selection, etc.)

**Utils** (`src/components/ui/tldraw/utils/`):
- `collaborationOverrides.ts` - TLDraw UI overrides for pin-to-viewport action

**Main Component**: Simplified orchestration of hooks and TLDraw setup

#### 2. `livekit-room-connector.tsx` (1220 LOC → 233 LOC | 81% reduction)

Extracted into clean, testable modules:

**Hooks** (`src/components/ui/livekit/hooks/`):
- `useLivekitConnection.ts` - Handles token fetch and room connection
- `useAgentDispatch.ts` - Manages AI agent dispatch and tracking
- `useRoomEvents.ts` - Sets up event listeners for room state changes

**Components** (`src/components/ui/livekit/components/`):
- `RoomConnectorUI.tsx` - Presentational UI component (287 LOC)

**Main Component**: Simplified state management and hook orchestration

### Patterns Established

- **Target**: ≤300 LOC per primary component file
- **Hooks**: Single responsibility, typed interfaces, cleanup functions
- **Components**: Pure presentational, props-driven
- **Utils**: Pure functions, zero side effects

### Remaining Candidates

3. `src/components/ui/presentation/presentation-deck.tsx` (~820 LOC)
4. `src/components/ui/documents/markdown-viewer-editable.tsx` (~818 LOC)
5. `src/components/ui/productivity/action-item-tracker.tsx` (~700-900 LOC)
