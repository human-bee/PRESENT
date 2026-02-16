# Fairy Ingress (Server-First)

This project uses a **server-first fairy intent pipeline**.

## Supported execution path

All supported fairy/canvas intent execution goes through:

1. `POST /api/steward/runCanvas`
2. `task: "fairy.intent"` (or `canvas.agent_prompt` for direct canvas prompts)
3. Conductor routing + queue arbitration
4. Server steward execution + broadcast

This keeps lock/idempotency/trace behavior consistent with the rest of the agent runtime.

## Unsupported legacy path

Client-side fairy execution via `/api/fairy/stream-actions` is retired.
Do not use or reintroduce it for production/demo flows.

## Runtime flags (recommended)

```bash
NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false
NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED=false
CANVAS_STEWARD_SERVER_EXECUTION=true
CANVAS_QUEUE_DIRECT_FALLBACK=false
```

`NEXT_PUBLIC_FAIRY_ENABLED` controls whether fairy UI affordances are shown.
It does **not** change the server-first execution contract.

## Local verification

1. Start stack:

```bash
npm run stack:start
```

2. Open `/canvas` and connect room/agent.
3. Send a fairy-style request via voice or supported UI prompt.
4. Verify queued dispatch in logs and request path:
   - `/api/steward/runCanvas`
   - `task: "fairy.intent"`

## Debug note

If you need emergency debugging of legacy behavior, document it explicitly in a throwaway branch and do not ship it to `main`.
