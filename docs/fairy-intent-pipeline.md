# Fairy Intent Pipeline (Server-First Hybrid Lane)

This document defines the supported fairy intent contract.

## Goals

- Single ingress contract for voice/UI/fairy-like intents.
- Queue-first orchestration with idempotency and lock-aware ordering.
- Fast lane for view/layout events and slow lane for steward tasks.
- Explicit fallback semantics under queue outage.

## Canonical ingress

Use:

```http
POST /api/steward/runCanvas
```

With payload:

```json
{
  "room": "canvas-xyz",
  "task": "fairy.intent",
  "requestId": "optional-idempotency-request-id",
  "traceId": "optional-trace-id",
  "intentId": "optional-intent-id",
  "params": {
    "id": "optional-intent-id",
    "room": "canvas-xyz",
    "message": "draw a roadmap",
    "selectionIds": ["shape:abc"],
    "bounds": { "x": 0, "y": 0, "w": 100, "h": 100 },
    "contextProfile": "standard",
    "metadata": { "source": "fairy-ui" }
  }
}
```

## Queue/orchestration behavior

`runCanvas` normalizes and applies orchestration envelope fields:

- `executionId`
- `idempotencyKey`
- `lockKey`
- `attempt`

For `fairy.intent` and `canvas.agent_prompt`, requests are coalesced by resource and include room-scoped resource keys (`room:*`, `canvas:intent`, plus lock key when present).

## Conductor routing model

`fairy.intent` is routed by conductor to the appropriate lane:

- Fast lane: `dispatch_dom_event` for view/layout intents
- Slow lane: steward task execution (for example `canvas.agent_prompt`, scorecard, infographic)

## Fallback behavior

When queue enqueue fails:

- If direct fallback is disabled: return queue-unavailable semantics (`503`) or `broadcast_only` when appropriate.
- If direct fallback is enabled and server steward is allowed: execute steward directly and emit trace with `stage: "completed"` and `status: "executed_fallback"`.

## Feature flags and execution authority

Supported production mode keeps client execution disabled:

```bash
NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false
NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED=false
CANVAS_STEWARD_SERVER_EXECUTION=true
```

This ensures server steward authority and avoids split-brain behavior.

## Legacy path status

`/api/fairy/stream-actions` is retired and not part of the supported execution contract.

## Related docs

- `docs/fairy.md`
- `docs/demo-race-track.md`
- `docs/demo-debate-canvas-race-track.md`
