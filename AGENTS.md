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

> 💡 **Tip:** `npm run stack:start` launches the full stack (voice agent + conductor + sync server + web) with logs in `logs/*.log`.

### Production

- `npm run build`: Build the Next.js app (one-time).
- `npm run agent:realtime`: Run the voice agent.
- `npm run agent:conductor`: Run the conductor queue workers.
- `npm run start`: Run the production Next.js server.

### Testing & Quality

- `npm test`: Run Jest tests.
- `npm run test:watch`: Run tests in watch mode.
- `npm run lint`: Run ESLint/Next rules.

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

## Agent Runtime & Security

- Start agents before the web app. Voice agent should log "session started"; conductor logs queue throughput.
- Secrets live in `.env.local` (never commit). Required: LiveKit, OpenAI, Supabase, etc.
- Voice agent enqueues tasks; conductor fetches from Supabase.

# Agents: Runtime, Roles & Contracts

If it doesn't move the canvas, it doesn't belong in the voice agent. We separate real-time audio responsiveness from heavy reasoning.

## Startup Scripts (queue architecture)

- `npm run agent:realtime`: LiveKit voice agent. Listens, transcribes, **enqueues** tasks (fire-and-forget). No direct tool calls.
- `npm run agent:conductor`: Queue workers that claim `agent_tasks` rows, execute stewards (canvas, flowchart, youtube), and emit tool events back to the browser.
- Both must be running for steward-managed workflows.

## Topology

- **Voice Agent (Realtime, Node)**
  - Streaming STT → LLM (gpt-realtime) → `enqueue_task` tool.
  - Emits `tool_call` events only to confirm queueing. Never calls canvas tools directly.
- **Conductor Workers (Node)**
  - Poll `agent_tasks` table, respect per-room/resource locks, execute appropriate steward, write results/logs.
- **Stewards**
  - Flowchart, Canvas, YouTube, etc. Each receives stable params from the conductor. Canvas steward still owns internal scheduling.
- **Browser ToolDispatcher**
  - Listens for steward outputs (`tool_call`, `tool_result`), applies UI changes, publishes status.
- **Supabase**
  - Queue storage (`agent_tasks`), transcripts, flowchart documents.

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
