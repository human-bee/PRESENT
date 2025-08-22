## PRE-133 — Voice → Tool Routing: Local-first Path, MCP Init, and Component Generation Reliability

- Owner: AI & Agent Features
- Status: Draft v1
- Source: Linear `PRE-133`
- Related: `src/app/canvas/page.tsx`, `src/components/tool-dispatcher.tsx`, `src/components/ui/message-thread-collapsible.tsx`, `src/lib/tambo.ts`

## Summary
We will implement a deterministic, low-latency pipeline from voice transcripts → decision engine → ToolDispatcher → local component generation, with MCP initialized early and reliably available. The solution prioritizes local-first execution to minimize cloud roundtrips, while preserving a controlled, observable fallback to cloud when needed. Component generation becomes deterministic and robust by enforcing typed contracts and always dispatching real React elements via the Tambo event bus.

## Problem Statement
- Voice-driven user intents intermittently route through cloud, increasing latency and flakiness.
- MCP (Model Context Protocol) init can be late, causing tool unavailability during dispatch.
- Component generation occasionally fails due to untyped payloads, deferred MCP bridges, or fuzzy tool resolution.

## Goals
- Deterministic routing from decision engine → ToolDispatcher → local component generation.
- Early MCP bridge initialization so tools are available at first dispatch.
- Local-first execution path with measurable latency reduction.
- Stronger, typed event contracts to ensure component generation reliability.
- Clear feature flags to control rollout and enable full cloud bypass for chat thread when desired.
- Observability across each hop (decision, dispatch, tool run, component render) to debug quickly.

## Non-Goals
- Redesigning the entire decision engine’s ML logic.
- Replacing the existing cloud stack; cloud remains a fallback.
- Building a new MCP server; we focus on init timing and integration.

## Context and Current State
Recent edits (merged):
- `src/app/canvas/page.tsx`: dynamic room by canvas id; gated `EnhancedMcpProvider`; tools validation into `TamboProvider`.
- `src/components/ui/message-thread-collapsible.tsx`, `src/lib/tambo.ts`: always dispatch real React elements for `tambo:showComponent`; safe handling for object payloads.
- `src/components/tool-dispatcher.tsx`: initialize MCP bridge early; fuzzy `mcp_*` resolution.

Result to date:
- Voice-driven component creation works locally.
- Fewer cloud roundtrips; better perf.

Follow-ups requested:
- Feature flag to fully bypass cloud for chat thread.

## Proposed Architecture
### Deterministic Routing Pipeline
1. Voice partials/finals arrive → DecisionEngine produces an Intent with structured ToolInvocationRequest.
2. ToolDispatcher resolves local tool by id/name with robust aliasing (fuzzy → ranked, deterministic threshold) and validates arguments.
3. MCP bridge is guaranteed initialized before first dispatch; missing tools trigger controlled retries or cloud fallback.
4. Tool result is posted as a typed Tambo event that constructs a real React element (not raw objects) and mounts safely.
5. Telemetry is emitted at each hop with correlation ids (conversationId, canvasId, requestId).

### Local-first with Cloud Fallback
- Default path executes locally when flags permit and MCP is healthy.
- If resolution/validation fails or a timeout occurs, route to cloud with the same request id and full context to preserve idempotency.

### Typed Contracts and Eventing
- Tool requests/results and UI mount events adopt strict TS types; Tambo only carries serializable payloads and React-constructable descriptors.

```ts
// Pseudo-types for clarity
export type ToolInvocationRequest = {
  requestId: string;
  canvasId: string;
  source: 'voice' | 'chat' | 'system';
  toolName: string;           // canonical
  aliases?: string[];         // optional fuzzy candidates
  args: Record<string, unknown>;
  priority?: 'realtime' | 'default' | 'background';
  deadlineMs?: number;        // SLA for local execution
};

export type ToolInvocationResult = {
  requestId: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
  component?: React.ReactElement; // or a typed descriptor used to construct one
  data?: unknown;                 // structured tool output
};
```

### Early MCP Init
- Initialize MCP bridge during canvas/room mount, behind a guard that ensures readiness before first dispatch.
- Expose `waitForMcpReady(timeoutMs)` to the dispatcher; dispatcher gates local execution on MCP readiness (with a short timeout) before fallback.

### Tool Resolution Strategy
- Maintain a canonical registry: `toolId → handler`, with alias map for `mcp_*` fuzzy names.
- Rank fuzzy matches deterministically (exact > prefix > levenshtein) with stable tie-breakers and a minimum score threshold.

### Component Generation Reliability
- `tambo:showComponent` must receive either a real React element or a typed descriptor that is synchronously convertable to an element.
- Strict runtime validation on payloads; reject unsafe objects; log structured validation errors.

## Feature Flags
- `local_tool_routing_enabled` (default on in dev/staging): Enables local-first routing.
- `mcp_early_init_enabled` (default on): Ensures MCP bridge is initialized during canvas mount.
- `bypass_cloud_chat_thread` (default off): Routes chat thread tool calls locally when possible and suppresses cloud calls unless explicitly requested.
- `tool_dispatch_strict_types` (default on): Enforces typed contracts and runtime validation.
- `tool_dispatch_kill_switch` (default off): Emergency off for the dispatcher (fail back to cloud).

## Acceptance Criteria
- With `local_tool_routing_enabled` and `mcp_early_init_enabled` on:
  - ≥ 99% of voice-driven tool invocations resolve locally without cloud fallback during healthy periods.
  - P95 time from final voice segment to first component render ≤ 700 ms on a warmed client; ≤ 1100 ms on cold init.
  - Zero crashes from `tambo:showComponent` due to non-element payloads.
  - Deterministic tool selection given identical input (same requestId → same tool/args).
- With `bypass_cloud_chat_thread` on:
  - Chat tool invocations execute locally ≥ 95% of the time with correctness parity to cloud.
- Observability:
  - Each request produces a trace with spans for decision, resolve, mcp_ready, tool_exec, ui_mount; errors are correlated by `requestId`.

## Observability & Telemetry
- Add trace/metrics for:
  - MCP readiness time, tool resolution latency, tool exec latency, UI render latency.
  - Local vs cloud path counters; fallback reasons; validation error types.
- Redact PII in logs; store only hashed identifiers for user/session where applicable.

## Detailed Design Notes
### Decision Engine
- Emits `ToolInvocationRequest` with canonical `toolName`. If only an alias is known, include it in `aliases`.
- Provides `deadlineMs` for realtime intents to guide dispatcher timeouts.

### ToolDispatcher
- Validates args against a tool schema (Zod/TypeScript) before execution.
- Resolves tool via canonical map + alias ranking; below-threshold scores trigger rejection or clarification.
- If MCP not ready: wait up to `mcpReadyTimeoutMs` (e.g., 150 ms) then fallback per policy.
- Emits Tambo events only after successful validation and element construction.

### MCP Bridge
- Start during `canvas/page.tsx` mount under `EnhancedMcpProvider`, report readiness via a promise.
- Healthcheck exposed to dispatcher for gating.

### Tambo Integration
- `tambo:showComponent` strictly takes `ReactElement | ComponentDescriptor`.
- Safe guards for object payloads and clear error surface.

### Security & Privacy
- Disallow execution of unregistered tools.
- Validate and sanitize all args; no arbitrary code execution via payloads.
- Ensure local tool execution respects permissions and room/canvas scoping.

## Performance Targets
- MCP ready P95 ≤ 300 ms after canvas mount; P99 ≤ 600 ms.
- Local tool resolve+exec (excluding UI) P95 ≤ 250 ms.
- First meaningful component render P95 ≤ 700 ms from final voice segment.

## Rollout Plan
1. Dev: Enable `local_tool_routing_enabled`, `mcp_early_init_enabled`, observe traces.
2. Staging: Progressive rollout to 25% → 50% → 100%; enable `tool_dispatch_strict_types`.
3. Production: Start with 10%, monitor error budget and latency SLOs; gradually enable `bypass_cloud_chat_thread`.
4. Kill Switch: `tool_dispatch_kill_switch` toggles immediate cloud fallback.

## Test Plan
- Unit
  - Tool resolution ranking, schema validation, descriptor → element conversion.
  - MCP readiness gating logic.
- Integration
  - Voice → decision → dispatch → tool → UI mount path, including fallback.
  - Error injection: invalid args, missing tool, MCP delay.
- E2E (Playwright on canvas UI)
  - Voice-driven component creation renders expected UI and telemetry spans.
  - Feature flag permutations (local-first on/off, bypass chat on/off).
  - Use browser MCP console logs to verify readiness and dispatch order.
- Performance
  - Measure P95/P99 latencies; cold vs warm paths; retry behavior.

## Migration & Backward Compatibility
- Flags default to current behavior when off; no breaking changes.
- Components and tools remain compatible with existing Tambo events.

## Risks & Mitigations
- MCP cold start delays → early init + short gating timeout + fallback.
- Fuzzy tool misrouting → deterministic ranking with threshold and telemetry for corrections.
- Payload type drift → strict schemas and runtime validation.

## Open Questions
- Does decision engine need to emit clarifying questions when confidence is low, or should dispatcher handle ask-back?
- What is the minimum viable alias map to ship with, and how is it curated?

## Appendix: Example Sequence
1. Voice final → `Intent{toolName:'mcp_createComponent', args:{...}}`.
2. Dispatcher waits `mcpReady` (≤150 ms), validates args.
3. Local tool executes, returns `ComponentDescriptor`.
4. Convert to React element, emit `tambo:showComponent`.
5. UI mounts component; telemetry recorded across spans.