# Unified Canvas Agent

The **Canvas Agent** is a server-centric architecture that achieves full TLDraw Agent Starter Kit parity. The server handles all planning, scheduling, and model interactions, while the browser acts purely as "eyes and hands"—providing viewport/selection context and executing streamed actions.

> Building or updating components/stewards? See the companion [Component & Steward Integration Guide](./component-steward-guide.md) for contracts, perf budgets, and testing checklists.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         VOICE AGENT                              │
│  (dispatch_to_conductor with task: "canvas.agent_prompt")       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CANVAS AGENT RUNNER                           │
│  • Build prompt context (shapes, transcript, viewport)           │
│  • Call model (streaming)                                        │
│  • Parse & sanitize TLDraw-native actions                        │
│  • Broadcast action envelopes via LiveKit                        │
│  • Handle meta actions (think, todo, add_detail)                 │
│  • Queue follow-ups & todos                                      │
└────────────────────────────┬────────────────────────────────────┘
                             │ LiveKit Data Channel
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  BROWSER 1   │    │  BROWSER 2   │    │  BROWSER N   │
│              │    │              │    │              │
│  Connectors: │    │  Connectors: │    │  Connectors: │
│  • Viewport  │    │  • Viewport  │    │  • Viewport  │
│  • Selection │    │  • Selection │    │  • Selection │
│  • Screenshot│    │  • Screenshot│    │  • Screenshot│
│              │    │              │    │              │
│  Executors:  │    │  Executors:  │    │  Executors:  │
│  • Apply     │    │  • Apply     │    │  • Apply     │
│    actions   │    │    actions   │    │    actions   │
│  • Send ack  │    │  • Send ack  │    │  • Send ack  │
└──────────────┘    └──────────────┘    └──────────────┘
```

## Server Components

### Runner (`src/lib/agents/canvas-agent/server/runner.ts`)

Main orchestration loop:

1. **Status**: `waiting_context`
2. Build prompt parts (shapes, transcript, viewport)
3. **Status**: `calling_model`
4. Invoke model with streaming
5. **Status**: `streaming`
6. Parse incremental TLDraw-native actions
7. Sanitize actions
8. Broadcast action envelopes (with `seq`, `partial`)
9. Handle meta actions:
   - `think` → `agent:chat` message
   - `todo` → persist to Supabase
   - `add_detail` → enqueue follow-up
10. On stream end:
    - If queue not empty → `scheduled` & loop next
    - Else → `done`

### Wire (`src/lib/agents/canvas-agent/server/wire.ts`)

LiveKit data channel helpers:

- `sendActionsEnvelope(room, sessionId, seq, actions, {partial?})`
- `sendChat(room, sessionId, message)`
- `sendStatus(room, sessionId, state, detail?)`
- `requestScreenshot(room, request)` (orchestrated by runner with response listener)

### Context Builder (`src/lib/agents/canvas-agent/server/context.ts`)

Assembles prompt parts:

- Transcript window (last 60s by default)
- Canvas shapes (cap at 300 blurry shapes)
- Viewport bounds
- Selection IDs
- Document version (for screenshot cache key)

### Models (`src/lib/agents/canvas-agent/server/models.ts`)

Provider registry with streaming interface:

- Default: `debug/fake` (smoke testing)
- Production: Anthropic/OpenAI/Google (add your provider)
- Per-request override support

### Sanitizer (`src/lib/agents/canvas-agent/server/sanitize.ts`)

Validates and sanitizes model outputs:

- Check shape existence; drop invalid refs
- Clamp numeric bounds (NaN/Infinity guards)
- Validate enums (color, fill, style)
- Generate agent shape IDs (`ag:{nanoid}`)
- Reorder dependent actions (create before update)

### Brand palette + TLDraw colors

- Models are allowed to mention either the TLDraw palette (`red`, `orange`, `blue`, …) or branded names (`brutalist-orange`, `burnt orange`, `charcoal`).
- `runner.ts` normalizes every streamed action before TLDraw sees it:
  - Partial strings (e.g., `"r"`, `"yel"`) are dropped until the model emits a valid color name, preventing validation crashes.
  - Brand aliases are mapped to the closest TLDraw key (brutalist/burnt orange → `orange`, deep orange → `red`, charcoal/ink → `black`, etc.).
  - Dash, fill, font, and size props are also coerced to TLDraw’s enums, and blanks are removed.
- Shape kinds (`box`, `sticky`, `headline`, …) are mapped to TLDraw shape types, and any action with an unknown/partial `type` (e.g., `"r"`) is ignored until the model finishes spelling it out. This keeps TLDraw from throwing “No shape util found for type ‘r’”.
- Result: the agent prefers our brutalist palette but still has the full TLDraw color wheel available when a request requires it.

### Tool catalog & brand macros

- The steward accepts higher-level macro actions so the model can work faster:
  - `apply_preset` with params `{ preset: 'Hero'|'Callout'|'Quiet'|'Wire'|'Label', targetIds?: string[], x?: number, y?: number, text?: string }`.
  - When `targetIds` is provided we emit `update_shape` for each id; otherwise we create a new note with the brand tokens.
  - The macro recognises synonyms (hero/headline, tag/label, etc.) and automatically maps to TLDraw colors/fonts.
- Documented TLDraw verbs (`create_shape`, `update_shape`, `align`, `stack`, `set_viewport`, `think`, `todo`, `add_detail`) now appear in the system prompt’s tool catalog so the model stops inventing action names.
- For freehand strokes, create a TLDraw `draw` shape: `create_shape { type: 'draw', props: { segments: [{ type: 'free', points: [{x,y,z?}] }], color, size } }`. Segments are preserved verbatim, so the model controls pen fidelity via points.
- TLDraw-native verbs exposed to the steward: `create_shape`, `update_shape`, `delete_shape`, `move`, `resize`, `rotate`, `group`, `ungroup`, `align`, `distribute`, `stack`, `reorder`, `set_viewport`, `think`, `todo`, `add_detail`. Keeping this list in-sync with the prompt avoids “I don’t have that tool” responses.
- Duplicate creates are ignored; once a block exists, issue `update_shape`/`move`/`resize` instead of re-running the same preset. Dedupe stats are logged as `[CanvasAgent:Dedupe]` so you can spot wasted actions in `logs/agent-conductor.log`.

### Schema guard & JSON manifest

- `src/lib/canvas-agent/contract/tooling/catalog.ts` builds a single source of truth for action schemas (via `zod-to-json-schema`). We embed the resulting JSON in the prompt (`toolSchema`) and log `[CanvasAgent:SchemaGuard]` whenever a malformed action hits the steward before sanitization.
- The same module exports a machine-readable tool catalog (name, description, params, sample) that’s delivered with every prompt. This mirrors the TLDraw starter-kit mini spec so models stop guessing verb names.
- Update this file whenever you add a verb or new param or the manifest will drift.

### Prompt caching & Anthropic beta

- Anthropic calls now include `cacheControl: { type: 'ephemeral', ttl: ANTROPHIC_CACHE_TTL }` so the Responses API can reuse the static system/context chunks. After the first turn in a room we see ~0.5‑1 s lower time-to-first-action.
- The server memoizes prompt parts (minus screenshots) per `{room, docVersion, selection, viewport, transcript}` signature for ~2 minutes. Coming back to the same canvas reuses the cached chunks instantly and only requests a fresh screenshot.
- Disable either layer via `CANVAS_AGENT_DISABLE_PROMPT_CACHE=1` or tweak `ANTHROPIC_CACHE_TTL` (`5m`/`1h`).

### Screenshot reliability & retries

- Screenshot capture now retries when the room has just connected or the client is momentarily busy.
- Config via env:
- `CANVAS_AGENT_SCREENSHOT_RETRIES` — additional attempts after the initial timeout (default `1`).
- `CANVAS_AGENT_SCREENSHOT_RETRY_DELAY_MS` — wait between attempts (default `450` ms).
- `CANVAS_AGENT_LOW_ACTION_THRESHOLD` — if a model run emits fewer actions than this value (default `6`), the scheduler enqueues a deterministic follow-up with stricter sampling.
- `CANVAS_AGENT_CONFIG` — optional JSON blob that overrides the knobs above in one place (example: `{"screenshot":{"timeoutMs":5000,"retries":2},"followups":{"lowActionThreshold":4}}`). Use this to keep parity with the starter kit defaults without juggling multiple env vars.
- Follow-up passes always request a fresh screenshot, even when the legacy client agent is disabled.

### Evaluation snapshot

- Run the brutalist-poster smoke test (`Connect → Request agent → “Draft a brutalist poster concept…”`).
- Compare the result with `docs/examples/brutalist-poster.png`; the canonical output shows a hero headline, supporting block, vertical divider, and three sticky notes. Deviations point to context/screenshot regressions.

### Scheduler & Todos (`src/lib/agents/canvas-agent/server/scheduler.ts`, `todos.ts`)

Task queue and todo management:

- Per-session FIFO queue with bounded depth (`CANVAS_AGENT_MAX_FOLLOWUPS=3`)
- Watchdog timer (60s) to prevent runaway loops
- Persist todos to Supabase `canvas_agent_todos` table
- Reflect changes via `agent:chat`

## Client Components

### Connectors (Read-Only)

**Viewport/Selection Publisher** (`useViewportSelectionPublisher.ts`)

- Publishes viewport bounds + selection IDs at 80ms debounce
- Active only when agent session is running

**Screenshot Request Handler** (`useScreenshotRequestHandler.ts`)

- Listens for `agent:screenshot_request`
- Calls `editor.toImage()` with size limits (800px default)
- Returns `{dataUrl, bounds, viewport, selection, docVersion}`

### Executors (Write-Only)

**TLDraw Action Handlers** (`handlers/tldraw-actions.ts`)

Implements all TLDraw-native actions via editor API:

- **Core**: `create_shape`, `update_shape`, `delete_shape`
- **Transform**: `move`, `resize`, `rotate`, `group`, `ungroup`
- **Layout**: `align`, `distribute`, `stack`, `reorder`
- **Meta**: `think` (append to chat UI), `todo` (update UI list), `set_viewport` (host-only smooth pan/zoom), `add_detail` (no-op on client)

**Tool Dispatcher** (`tool-dispatcher.tsx`)

Routes `agent:action` envelopes:

- Gate by `v:'tldraw-actions/1'`
- Enforce per-session `(action.id)` idempotency
- Emit `agent:ack` after apply
- Host election for viewport actions

## Wire Protocol

### Action Envelopes (Server → Client)

```typescript
type AgentActionEnvelope = {
  v: 'tldraw-actions/1';      // schema version
  sessionId: string;          // one per agent run
  seq: number;                // strictly increasing per session
  partial?: boolean;          // streaming fragments
  actions: Array<{
    id: string;               // stable per logical action across partials
    name: ActionName;         // TLDraw-native names
    params: unknown;          // validated server-side (Zod)
  }>;
  ts: number;
}
```

**Topic**: `agent:action`

### Ack (Client → Server)

```typescript
{ type: 'agent:ack', sessionId: string, seq: number, clientId: string }
```

- Server retries if no ack within N ms (bounded)
- Clients must treat `(sessionId, action.id)` as **idempotent**, ignoring duplicates

### Screenshot RPC

**Request** (Server → Client)

```typescript
{
  type: 'agent:screenshot_request',
  sessionId: string,
  requestId: string,
  bounds?: { x, y, w, h },
  maxSize?: { w, h }
}
```

**Response** (Client → Server)

```typescript
{
  type: 'agent:screenshot',
  sessionId: string,
  requestId: string,
  image: { mime: 'image/png', dataUrl: string, bytes: number },
  bounds: { x, y, w, h },
  viewport: { x, y, w, h },
  selection: string[],
  docVersion: string
}
```

**Topic**: `agent:screenshot_request` / `agent:screenshot`

### Chat / Status (Server → Client)

```typescript
{ type: 'agent:chat', sessionId: string, message: { role: 'assistant'|'system', text: string } }
{ type: 'agent:status', sessionId: string, state: 'waiting_context'|'calling_model'|'streaming'|'scheduled'|'done'|'canceled'|'error', detail?: unknown }
```

**Topics**: `agent:chat`, `agent:status`

## TLDraw-native Action Vocabulary

All actions follow the TLDraw Agent Starter Kit naming:

- **Core**: `create_shape`, `update_shape`, `delete_shape` (use `type: 'draw'` + `props.segments` for pen strokes)
- **Transform**: `move`, `resize`, `rotate`, `group`, `ungroup`
- **Layout**: `align`, `distribute`, `stack`, `reorder`
- **Meta**: `think`, `todo`, `add_detail`, `set_viewport`

> **No `canvas_*` names**. All legacy `canvas_*` tools have been removed.

## Configuration

> Archived client agent
>
> The TLDraw client agent is archived. Leave `NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false` in all environments. The unified server steward is the single source of truth; enabling the client agent will bypass the server steward and can cause divergent behavior.

Environment variables (see `example.env.local`):

```bash
CANVAS_AGENT_UNIFIED=true
CANVAS_STEWARD_MODEL=debug/fake
# Or use a real provider: anthropic:claude-3-5-sonnet-20241022
CANVAS_STEWARD_DEBUG=false
CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS=3500
CANVAS_AGENT_SCREENSHOT_RETRIES=1
CANVAS_AGENT_SCREENSHOT_RETRY_DELAY_MS=450
CANVAS_AGENT_LOW_ACTION_THRESHOLD=6
CANVAS_AGENT_TTFB_SLO_MS=200
NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false  # legacy client agent (archived, leave false unless forced fallback)
NEXT_PUBLIC_CANVAS_AGENT_THEME_ENABLED=true
CANVAS_QUEUE_DIRECT_FALLBACK=false
CANVAS_AGENT_MAX_FOLLOWUPS=3
# Upper bound for serialized TLDraw shape state appended to prompts (bytes)
CANVAS_AGENT_SHAPE_STATE_LIMIT=4096
```

> The server-side canvas steward is the only supported execution path. Setting `NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=true` is a last-resort debug switch that also disables the server steward; do not flip this flag unless absolutely necessary.

## Service Level Objectives (SLOs)

- **TTFB ≤ 200ms** (first action envelope)
- **Screenshot ≤ 150ms** (thumbnail, ≤800px long side)
- **95p apply jitter ≤ 50ms** (host client)

## Observability

Per-session structured logs:

- Prompt token estimate, shape counts, image bytes, docVersion
- `shapeStateStats` (count, bytes, truncated) for TLDraw runtime state included in prompts
- TTFB to first action, time to first applied
- Stream chunk count, retries/acks, queue depth, follow-up count
- Redact user content & image payloads by default

## Reliability & Degrade Scenarios

**Out-of-Order Envelopes**

- Clients ignore envelopes with `seq` less than last applied

**Duplicate Envelopes**

- Clients maintain per-session applied action ID set
- Idempotent ignore on duplicate `action.id`

**Ack Retry**

- Server retries bounded times
- Failure surfaces error status

**No Screenshot (Timeout)**

- Runner continues with text-only prompt parts
- Log degraded run

**Host Loss Mid-Run**

- Re-elect host among remaining clients
- If none, continue text-only (no viewport/screenshot)

**Stale Selection**

- Proceed with viewport only

## Database Schema

### `canvas_agent_todos` Table

```sql
create table public.canvas_agent_todos (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  text text not null,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index canvas_agent_todos_session_idx
  on public.canvas_agent_todos(session_id, status, position);
```

See `docs/migrations/001_canvas_agent_todos.sql` for full migration.

## API Routes

### `POST /api/canvas-agent/run`

```typescript
{
  roomId: string;
  message: string;
  model?: string;
  viewport?: { x, y, w, h };
}
```

Returns `{ ok: true }` on success.

## Testing Strategy

### Unit Tests

- Parsers: validate all action schemas + envelope
- Sanitizer: malformed action handling
- Scheduler: queue depth, watchdog, cancellation
- IDs: ID generation format

### Integration (E2E)

- Two-client same room: all core/transform/layout actions apply identically
- Meta actions: think → chat, todo → persist/UI, add_detail → follow-up loop
- Host-only `set_viewport` behavior
- Degrade scenarios: no screenshot, stale viewport, host loss

### Performance

- TTFB, screenshot time, apply jitter within SLOs
- Alert on regression

## Troubleshooting

**Agent not running**

- Verify `npm run agent:realtime` is running
- Check agent logs: `tail -f logs/agent-realtime.log`
- Ensure LiveKit server is running: `npm run lk:server:dev`

**Actions not applying**

- Check browser console for `present:agent_actions` events
- Verify action envelopes have correct `v:'tldraw-actions/1'`
- Check for TypeScript errors in action handlers

**Screenshot timeout**

- Increase `CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS` (minimum enforced: 2500 ms)
- Check network latency
- Verify host election (only host responds to screenshot requests)

**Model errors**

- Check provider API keys in `.env.local`
- Review `CANVAS_STEWARD_MODEL` value
- Enable `CANVAS_STEWARD_DEBUG=true` for verbose logs

## Future Enhancements

- **Coordinate offsets**: maintain chat origin offset across turns (TLDraw kit pattern)
- **BlurryShapes & PeripheralClusters**: token-bounded shape summaries (implement prompt parts from kit)
- **Screenshot cache**: keyed by `{docVersion, boundsKey}`, TTL 10-30s
- **Real provider integrations**: Anthropic Claude, OpenAI GPT-4, Google Gemini
- **Advanced layout actions**: full align/distribute/stack implementations
- **Freehand strokes**: `create_shape` + `type:'draw'` with `props.segments[{ type:'free', points:[{x,y,z?}] }]`
- **Client-side TLDraw agent deprecation**: remove legacy `agent_prompt` path once unified agent is proven

## References

- [TLDraw Agent Starter Kit](https://tldraw.dev/starter-kits/agent)
- [TLDraw Editor API](https://tldraw.dev/reference/editor/Editor)
- [TLDraw v4.0 Release Notes](https://tldraw.dev/releases/v4.0.0)
