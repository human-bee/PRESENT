# Linear MCP Integration

This document describes the Linear pipeline as it exists today.

## Architecture overview

Linear operations are issued by the `LinearKanbanBoard` surface and resolved by the board's steward + MCP calls.

- UI captures user intent (`instruction`, drag/drop, sync actions).
- Voice can still trigger board updates, but it does so by mutating the board component state first.
- `LinearKanbanBoard` then runs `/api/ai/linear-steward` and MCP tool calls for actual Linear side effects.
- UI applies optimistic state and reconciles pending updates.

## Where this sits in the agent pipeline

For voice-driven updates, intent reaches Linear via widget patching (`create_component` / `update_component`) and then the board's own execution path.

Important: Linear side effects are not currently executed on the `runCanvas` queue lane, so queue-level lock ordering and trace semantics from canvas do not automatically apply to every Linear mutation.

## Security notes

- Linear API key is user-provided and scoped to the integration surface.
- Keep key handling in approved storage/transport paths only.
- Do not bypass steward/conductor contract with ad-hoc direct mutation paths.

## Operational notes

- Prefer issue identifiers in voice commands for deterministic updates.
- Expect board-local pending/synced/failed status in the UI.
- Rate-limit or auth failures should be surfaced without mutating unrelated board state.

## Future work

- OAuth-based auth flow.
- Stronger bidirectional reconciliation.
- Additional metadata and project-level filters.
