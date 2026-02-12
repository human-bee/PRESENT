# `AGENTS.md`

## Project Structure & Module Organization

- `src/app/`: Next.js routes (App Router) and API endpoints.
- `src/components/`: React UI (feature-based folders; see `docs/code-organization.md`).
  - `src/components/ui/canvas/hooks/`: TLDraw canvas hooks (component store, rehydration, LiveKit event wiring).
- `src/lib/`: Agent workers, tools, and utilities.
  - `src/lib/agents/realtime/voice-agent.ts`: Primary LiveKit agent (Realtime API).
  - `src/lib/agents/conductor/`: Queue-driven router + steward runners.
  - `src/lib/agents/subagents/`: Domain-specific stewards (flowchart, canvas, youtube, …).
  - `src/lib/agents/shared/`: Shared contracts, Supabase queue helpers.
  - `src/lib/archived-agents/`: Legacy agents for reference.
- `public/`: Static assets. `docs/`: additional project docs.
- Tests are colocated as `*.test.ts(x)` or under `__tests__/`; mocks live in `__mocks__/`.
- Env: copy `example.env.local` → `.env.local` and fill required keys.

## Build, Test, and Development Commands

### Development

- `npm install`: Install dependencies.
- `npm run agent:realtime`: Run the LiveKit Realtime voice agent (terminal 1 - start first).
- `npm run agent:conductor`: Run the queue worker + stewards (terminal 2).
- `npm run dev`: Run the web app at `http://localhost:3000` (terminal 3).
- `npm run sync:dev`: Run the TLDraw sync server locally.

> 💡 **Tip:** For quick local testing (including Chrome DevTools automation), you can launch the entire stack in the background with log files via `npm run stack:start`. The helper script starts `lk:server:dev` (runs `livekit-server --dev`), `sync:dev`, `agent:conductor`, `agent:realtime`, and `npm run dev`, writing to `logs/*.log` so you can tail them while driving the canvas.

### Production

- `npm run build`: Build the Next.js app (one-time).
- `npm run agent:realtime`: Run the voice agent.
- `npm run agent:conductor`: Run the conductor queue workers.
- `npm run start`: Run the production Next.js server.

### Testing & Quality

- `npm test`: Run Jest tests.
- `npm run test:watch`: Run tests in watch mode.
- `npm run lint`: Run Biome lint (src only).

> 💡 **Tip:** To test end-to-end, connect to LiveKit, request the agent, and speak/text requests; watch queue throughput in `logs/agent-conductor.log`.

## Coding Style & Naming Conventions

- TypeScript across app and agents. Prefer explicit types on public APIs.
- 2-space indentation; single quotes; consistent semicolons.
- Components: PascalCase (`UserMenu.tsx`); hooks/utils: camelCase; non-component files/folders: kebab-case.
- Keep modules small; colocate component styles and tests with the implementation.
- All files aim for ≤200 LoC. Extract helpers early. Keep repo clean.

## Testing Guidelines

- Framework: Jest with `jsdom` + Testing Library for React.
- Location: `*.test.ts(x)` next to code or in `__tests__/`.
- Mocks: `__mocks__/`, use `jest.mock`.
- Run `npm test` before PRs; cover agent queue contracts, LiveKit flows, UI actions.
- Test agent contracts with mock LiveKit data channel messages + queue operations.

## Commit & PR Guidelines

- Commits: Imperative ("fix: handle LiveKit reconnect").
- PRs: Include summary, linked issues, screenshots/logs for agent changes.
- Requirements: Passing `npm test`, `npm run lint`; no uncommitted changes.

## Data Compatibility & Persistence

- Optimize for forward compatibility. When schemas change, expect to reseed storage (Supabase, local JSON, etc.) rather than preserving legacy shapes.
- Call out intentional backwards-compat breaks in code comments and PR notes so future reviewers don’t block forward-looking work.
- This product is still unreleased—avoid adding feature gates/flags or "legacy" pathways for backwards compatibility. Prefer a single source of truth and remove old flows instead of toggling them.

## Agent Runtime & Security

> IMPORTANT — Client Canvas Agent is Archived
>
> The browser‑side TLDraw “client agent” is deprecated and must remain OFF. All canvas reasoning and generation runs on the server steward via the Conductor. Do not enable the client agent in dev or prod; it is a last‑ditch debug escape hatch only.

- Always start the agent before the web app. Look for "registered worker" and then "Job received!" in agent logs.
- Secrets live in `.env.local` (never commit). Required keys include LiveKit, OpenAI, custom, and Supabase.
- Dispatch is automatic: the agent joins all rooms in your LiveKit project.
- Canvas Agent runtime flags (see `docs/canvas-agent.md` for full details):
  - `CANVAS_AGENT_UNIFIED=true` enables the unified server-centric Canvas Agent (default).
  - `CANVAS_STEWARD_MODEL` selects the model provider (`debug/fake` by default; use `anthropic:claude-3-5-sonnet-20241022` for production).
  - `CANVAS_STEWARD_DEBUG=true` enables verbose request + streaming logs.
  - `CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS=3500` screenshot RPC timeout in milliseconds (floored at 2500ms so the steward reliably receives frames before giving up, even when back-to-back screenshot requests queue up).
  - `CANVAS_AGENT_TTFB_SLO_MS=200` target time-to-first-byte for first action envelope.
  - `NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=false` (archived) — keep this false. Turning it on disables the server steward and routes execution to the legacy browser agent. Do not enable except for one‑off emergency debugging.
  - `NEXT_PUBLIC_FAIRY_CLIENT_AGENT_ENABLED=false` keeps the local fairy agent off while still allowing the fairy UI. Enable only if you explicitly want client-side fairy execution.
  - `NEXT_PUBLIC_CANVAS_AGENT_THEME_ENABLED=true` keeps the TLDraw branding enabled even when the legacy client agent is off.
  - `CANVAS_QUEUE_DIRECT_FALLBACK=false` ensures canvas jobs only run via the queue/worker. Set to `true` only if Supabase is offline and you explicitly want synchronous execution (actions may duplicate).
  - `CANVAS_AGENT_MAX_FOLLOWUPS=3` max bounded depth for add_detail follow-up loops.
  - `CANVAS_AGENT_DURABLE_FOLLOWUPS=true` schedules follow-ups onto `agent_tasks` (`canvas.followup`) by default; if queue creds are unavailable the runner falls back to in-memory follow-up scheduling.
  - `CANVAS_AGENT_TRACE_MAX_EVENTS=120` caps `agent:trace` emission per run so observability stays non-blocking under heavy streaming.

# Agents: Runtime, Roles & Contracts

If it doesn't move the canvas, it doesn't belong in the voice agent. We separate real-time audio responsiveness from heavy reasoning.

## Startup Scripts (queue architecture)

- `npm run agent:realtime`: LiveKit voice agent. Listens, transcribes, **enqueues** tasks (fire-and-forget). No direct tool calls.
- `npm run agent:conductor`: Queue workers that claim `agent_tasks` rows, execute stewards (canvas, flowchart, youtube), and emit tool events back to the browser.
- Both must be running for steward-managed workflows.

## Topology

- **Voice Agent (Realtime, Node)**
  Listens to the room, transcribes, and calls UI tools (`create_component`, `update_component`) or delegates canvas work via `dispatch_to_conductor`.
  - Normalizes patches before they hit the browser (e.g., `"7m"` → `420` seconds, boolean/string coercion).
  - Suppresses duplicate `create_component` payloads by fingerprinting recent requests and reusing the existing componentId.
  - Emits data-channel messages only after local validation; all deduping happens here so the ToolDispatcher can stay dumb.
- **Canvas Agent (Unified, Node)**
  Server-centric "brain" that handles all TLDraw canvas operations. Builds prompts, calls models (streaming), sanitizes actions, and broadcasts TLDraw-native action envelopes to clients. Browser acts as "eyes and hands" only (viewport/selection/screenshot + action execution). See `docs/canvas-agent.md` for full architecture.
  - **Parity rule:** Treat the TLDraw SDK agent starter kit as the source of truth. Do **not** post-process or "fix" the model’s TLDraw actions on the server; instead, update prompts, tool catalog, or few-shot examples so the model emits valid TLDraw verbs on its own. Any new validation should live in the shared contract so it mirrors the upstream kit.
- **Conductor (Agents SDK, Node)**
  A tiny router that delegates to **steward** subagents via handoffs. No business logic. Runs on the OpenAI Agents SDK (which wraps the Responses API) so stewards can opt into Responses features without rewriting the router.
- **Stewards (Agents SDK, Node)**
  Domain owners (e.g., **Flowchart Steward**, **YouTube Steward**). They read context (Supabase), produce a complete artifact, and emit one UI patch or component creation.
- **Browser ToolDispatcher (React, client)**
  A bridge, not an agent. Executes `create_component`, `update_component`, and TLDraw-native actions streamed from Canvas Agent. Sends acks and tool results. Dispatches TLDraw DOM events when needed.
- **Supabase**
  Source of truth for transcripts, flowchart docs, canvas shapes, and Canvas Agent todos.

## Queue Fundamentals

- Table: `agent_tasks` with `status`, `priority`, `resource_keys`, `request_id` (idempotency), `lease_token` (worker locks).
- Voice Agent enqueues with `task: "conductor.dispatch"` + metadata.
- Workers claim tasks (`claim_agent_tasks` RPC) with lease TTL.
- Failures use exponential backoff (attempt count); after max retries mark `failed`.
- Resource keys ensure per-room ordering but allow cross-room parallelism.

## Environment Variables

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (required for queue workers).
- Optional tuning:
  - `TASK_DEFAULT_CONCURRENCY`
  - `TASK_MAX_CONCURRENCY_CANVAS`
  - `TASK_MAX_CONCURRENCY_FLOWCHART`
  - `TASK_MAX_CONCURRENCY_YOUTUBE`
  - `TASK_DEBOUNCE_MS_CANVAS`

## Operational Checklist

- Voice agent latency: <600–800 ms for enqueue acknowledgement.
- Conductor logs show claimed/completed tasks; monitor queue depth.
- Canvas prompts should coalesce—latest wins.
- Parallel tasks across different rooms/components run concurrently.

Check `/docs` for steward-specific playbooks.
