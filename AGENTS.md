# Repository Guidelines

## Project Structure & Module Organization

- `src/app/`: Next.js routes (App Router) and API endpoints.
- `src/components/`: React UI (custom UI, LiveKit UI, shared widgets).
- `src/lib/`: Agent workers, tools, and utilities.
  - `src/lib/livekit-agent-worker.ts`: Primary LiveKit agent (runs as a separate process).
  - `src/lib/livekit-agent-tools.ts`: Tool implementations used by the agent.
  - `src/lib/archived-agents/`: Alternate/experimental agents for reference.
- `public/`: Static assets.  `docs/`: additional project docs.
- Tests are colocated as `*.test.ts(x)` or under `__tests__/`; mocks live in `__mocks__/`.
- Env: copy `example.env.local` → `.env.local` and fill required keys.

## Build, Test, and Development Commands

- `npm install`: Install dependencies.
- `npm run agent:build`: Build the TypeScript agent worker.
- `npm run build`: Build the Next.js app.
- `npm run agent:dev`: Run the agent in dev (start this first).
- `npm run dev`: Run the web app at `http://localhost:3000`.
- Prod: `npm run agent:run` and `npm run start`.
- Tests: `npm test` (Jest) or `npm run test:watch`.
- Lint: `npm run lint` (ESLint/Next rules).

## Coding Style & Naming Conventions

- TypeScript across app and agent. Prefer explicit types on public APIs.
- 2-space indentation; single quotes; consistent semicolons.
- Components: PascalCase (`UserMenu.tsx`); hooks/utils: camelCase; non-component files/folders: kebab-case.
- Keep modules small; colocate component styles and tests with the implementation.

## Testing Guidelines

- Framework: Jest with `jsdom` and Testing Library for React.
- Location: `*.test.ts(x)` next to code or in `__tests__/`.
- Mocks: use `__mocks__/` and `jest.mock` where appropriate.
- Run `npm test` before PRs; cover critical paths (agent tools, LiveKit flows, UI actions).

## Commit & Pull Request Guidelines

- Commits: Clear, imperative messages (e.g., "fix: handle LiveKit reconnect").
- PRs: Include summary, linked issues, UI screenshots (when applicable), and notes for agent changes (logs or sample transcript).
- Requirements: Passing tests and lint (`npm test`, `npm run lint`); no uncommitted changes.

## Agent-Specific Instructions & Security

- Always start the agent before the web app. Look for "registered worker" and then "Job received!" in agent logs.
- Secrets live in `.env.local` (never commit). Required keys include LiveKit, OpenAI, custom, and Supabase.
- Dispatch is automatic: the agent joins all rooms in your LiveKit project.

Check /docs for more tips
