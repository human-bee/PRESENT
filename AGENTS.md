# `AGENTS.md`

## Project Structure & Module Organization

- `src/app/`: Next.js routes (App Router) and API endpoints.
- `src/components/`: React UI (feature-based folders; see `docs/code-organization.md`).
  - `src/components/ui/canvas/hooks/`: TLDraw canvas hooks (component store, rehydration, LiveKit event wiring).
- `src/lib/`: Agent workers, tools, and utilities.
  - `src/lib/agents/realtime/voice-agent.ts`: Primary LiveKit agent (Realtime API).
  - `src/lib/agents/conductor/`: Router agent with handoffs.
  - `src/lib/agents/subagents/`: Domain-specific stewards (flowchart, youtube, …).
  - `src/lib/agents/shared/`: Shared contracts and Supabase helpers.
  - `src/lib/archived-agents/`: Legacy agents for reference.
- `public/`: Static assets. `docs/`: additional project docs.
- Tests are colocated as `*.test.ts(x)` or under `__tests__/`; mocks live in `__mocks__/`.
- Env: copy `example.env.local` → `.env.local` and fill required keys.

## Build, Test, and Development Commands

### Development

- `npm install`: Install dependencies.
- `npm run agent:realtime`: Run the LiveKit Realtime voice agent (terminal 1 - start first).
- `npm run agent:conductor`: Run the Agents SDK conductor/stewards (terminal 2).
- `npm run dev`: Run the web app at `http://localhost:3000` (terminal 3).
- `npm run sync:dev`: Run the TLDraw sync server locally.

> 💡 **Tip:** For quick local testing (including Chrome DevTools automation), you can launch the entire stack in the background with log files via `npm run stack:start`. The helper script starts `lk:server:dev` (runs `livekit-server --dev`), `sync:dev`, `agent:conductor`, `agent:realtime`, and `npm run dev`, writing to `logs/*.log` so you can tail them while driving the canvas.

### Production

- `npm run build`: Build the Next.js app (one-time).
- `npm run agent:realtime`: Run the voice agent (terminal 1).
- `npm run agent:conductor`: Run the conductor/stewards (terminal 2).
- `npm run start`: Run the production Next.js server (terminal 3).

### Testing & Quality

- `npm test`: Run Jest tests.
- `npm run test:watch`: Run tests in watch mode.
- `npm run lint`: Run ESLint/Next rules.

> 💡 **Tip:** For Testing the UI use the chrome-devtools mcp - 'cmd+k' to open the chat sidebar. connect to the livekit room, request the agent, and send a text message to the voice-agent to test user experience with new features, workflows, stewards, components, etc.

## Coding Style & Naming Conventions

- TypeScript across app and agent. Prefer explicit types on public APIs.
- 2-space indentation; single quotes; consistent semicolons.
- Components: PascalCase (`UserMenu.tsx`); hooks/utils: camelCase; non-component files/folders: kebab-case.
- Keep modules small; colocate component styles and tests with the implementation.
- All files aim for ≤200 LoC. Extract helpers early.Keep Repo Clean and Nested

## Testing Guidelines

- Framework: Jest with `jsdom` and Testing Library for React.
- Location: `*.test.ts(x)` next to code or in `__tests__/`.
- Mocks: use `__mocks__/` and `jest.mock` where appropriate.
- Run `npm test` before PRs; cover critical paths (agent tools, LiveKit flows, UI actions).
- Test agent contracts with mock LiveKit data channel messages.

## Commit & Pull Request Guidelines

- Commits: Clear, imperative messages (e.g., "fix: handle LiveKit reconnect").
- PRs: Include summary, linked issues, UI screenshots (when applicable), and notes for agent changes (logs or sample transcript).
- Requirements: Passing tests and lint (`npm test`, `npm run lint`); no uncommitted changes.

## Agent-Specific Instructions & Security

- Always start the agent before the web app. Look for "registered worker" and then "Job received!" in agent logs.
- Secrets live in `.env.local` (never commit). Required keys include LiveKit, OpenAI, custom, and Supabase.
- Dispatch is automatic: the agent joins all rooms in your LiveKit project.
- Canvas Agent runtime flags (see `docs/canvas-agent.md` for full details):
  - `CANVAS_AGENT_UNIFIED=true` enables the unified server-centric Canvas Agent (default).
  - `CANVAS_STEWARD_MODEL` selects the model provider (`debug/fake` by default; use `anthropic:claude-3-5-sonnet-20241022` for production).
  - `CANVAS_STEWARD_DEBUG=true` enables verbose request + streaming logs.
  - `CANVAS_AGENT_SCREENSHOT_TIMEOUT_MS=300` screenshot RPC timeout in milliseconds.
  - `CANVAS_AGENT_TTFB_SLO_MS=200` target time-to-first-byte for first action envelope.
  - `NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=true` toggles legacy client-side TLDraw agent (keep true for backward compat during transition).
  - `CANVAS_AGENT_MAX_FOLLOWUPS=3` max bounded depth for add_detail follow-up loops.

# Agents: Runtime, Roles & Contracts

If it doesn't move the canvas, it doesn't belong in the voice agent. This document defines the small set of agents we actually run, the messages they speak, and the contracts the browser must honor—no more heuristic soup.

## Startup scripts (new architecture)

- `npm run agent:realtime`: Starts the LiveKit Realtime voice agent (`src/lib/agents/realtime/voice-agent.ts`). It listens to the room, transcribes, and emits only two UI tools: `create_component` and `update_component`.
- `npm run agent:conductor`: Starts the Conductor (Agents SDK). It routes `dispatch_to_conductor` requests to stewards (e.g., Flowchart Steward) using handoffs.
- Both must be running for the steward-managed flowchart pipeline.

## Topology (one screen's worth)

- **Voice Agent (Realtime, Node)**
  Listens to the room, transcribes, and calls UI tools (`create_component`, `update_component`) or delegates canvas work via `dispatch_to_conductor`.
  - Normalizes patches before they hit the browser (e.g., `"7m"` → `420` seconds, boolean/string coercion).
  - Suppresses duplicate `create_component` payloads by fingerprinting recent requests and reusing the existing componentId.
  - Emits data-channel messages only after local validation; all deduping happens here so the ToolDispatcher can stay dumb.
- **Canvas Agent (Unified, Node)**
  Server-centric "brain" that handles all TLDraw canvas operations. Builds prompts, calls models (streaming), sanitizes actions, and broadcasts TLDraw-native action envelopes to clients. Browser acts as "eyes and hands" only (viewport/selection/screenshot + action execution). See `docs/canvas-agent.md` for full architecture.
- **Conductor (Agents SDK, Node)**
  A tiny router that delegates to **steward** subagents via handoffs. No business logic. Runs on the OpenAI Agents SDK (which wraps the Responses API) so stewards can opt into Responses features without rewriting the router.
- **Stewards (Agents SDK, Node)**
  Domain owners (e.g., **Flowchart Steward**, **YouTube Steward**). They read context (Supabase), produce a complete artifact, and emit one UI patch or component creation.
- **Browser ToolDispatcher (React, client)**
  A bridge, not an agent. Executes `create_component`, `update_component`, and TLDraw-native actions streamed from Canvas Agent. Sends acks and tool results. Dispatches TLDraw DOM events when needed.
- **Supabase**
  Source of truth for transcripts, flowchart docs, canvas shapes, and Canvas Agent todos.

Check /docs for more tips
