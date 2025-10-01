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
  - `hooks/`: collaboration session + editor bridge hooks (`useCollaborationSession`, `useTldrawEditorBridge`).
  - `components/`: lightweight fragments like `CollaborationLoadingOverlay`.
  - `utils/`: granular event registries (`canvas-*-handlers.ts`), rich-text helpers, LiveKit wiring.
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

## Refactor Roadmap (2025-10)

Targeting files >300 LOC for decomposition. Prioritized by size/impact:

1. `src/components/ui/tldraw/tldraw-with-collaboration.tsx` (~1250 LOC)
   - Split TLDraw bus wiring, collaboration sync, and steward hooks into `hooks/` directory.
   - Extract UI overlays/toolbars into `components/`.
2. `src/components/ui/livekit/livekit-room-connector.tsx` (~1220 LOC)
   - Separate token-fetch and auto-connect flow into hooks.
   - Move render subsections (status banner, participant controls) into `livekit/components/`.
3. `src/components/ui/presentation/presentation-deck.tsx` (~820 LOC)
   - Break out controls, slide navigation, overlays.
4. `src/components/ui/documents/markdown-viewer-editable.tsx` (~818 LOC)
   - Extract diff rendering, markdown parsing, and header UI into dedicated modules.
5. `src/components/ui/productivity/action-item-tracker.tsx` & others in the 700–900 LOC range.

Each refactor pass should:

- Record pre/post line counts to monitor progress.
- Move reusable logic into feature folders (`hooks/`, `components/`, `utils/`).
- Run `npx eslint --ext .ts,.tsx` on touched files.
- Update tests/doc strings where behavior shifts.

_Remove this roadmap once completed._
