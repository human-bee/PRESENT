# Linear MCP Integration

This document describes the Linear pipeline as used by the current server-first orchestration architecture.

## Architecture overview

Linear operations are issued by the `LinearKanbanBoard` surface and routed through steward/tool execution paths.

- UI captures user intent (`instruction`, drag/drop, sync actions).
- Steward/subagent resolves intent into structured MCP calls.
- MCP calls execute against Linear via authenticated client/proxy path.
- UI applies optimistic state and reconciles pending updates.

## Where this sits in the agent pipeline

For voice-driven updates, intent flows through the voice/conductor path and reaches widget updates in the same queue-orchestrated runtime as other components.

This means Linear updates coexist with:

- queue arbitration,
- task-level ordering controls,
- shared trace/correlation semantics.

## Security notes

- Linear API key is user-provided and scoped to the integration surface.
- Keep key handling in approved storage/transport paths only.
- Do not bypass steward/conductor contract with ad-hoc direct mutation paths.

## Operational notes

- Prefer issue identifiers in voice commands for deterministic updates.
- Expect pending/synced/failed queue states in the board UI.
- Rate-limit or auth failures should be surfaced without mutating unrelated board state.

## Future work

- OAuth-based auth flow.
- Stronger bidirectional reconciliation.
- Additional metadata and project-level filters.
