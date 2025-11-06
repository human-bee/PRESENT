# custom Voice AI Application

A sophisticated Next.js application that combines custom AI's generative UI capabilities with LiveKit's real-time voice agents and Model Context Protocol (MCP) integration.

## 🎯 Features

- **Voice-Enabled AI Agent**: Real-time voice interactions powered by LiveKit and OpenAI
- **Generative UI Components**: Dynamic UI generation through custom AI
- **MCP Integration**: Connect to various AI tools and services via Model Context Protocol
- **Multi-Modal Interactions**: Support for both chat and voice interfaces
- **Canvas Collaboration**: Interactive canvas with AI-generated components
- **Demo Showcases**: Live captions, presentation deck, and toolbar demonstrations

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Valid API keys for:
  - custom AI
  - LiveKit (Cloud or self-hosted)
  - OpenAI
  - Supabase (for auth/storage)

### Installation

1. **Clone the repository**

```bash
git clone <your-repo-url>
cd PRESENT
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

- Copy `example.env.local` to `.env.local`
- Fill in all required API keys:

  ```
  NEXT_PUBLIC_custom_API_KEY=
  LIVEKIT_API_KEY=
  LIVEKIT_API_SECRET=
  LIVEKIT_URL=
  OPENAI_API_KEY=
  ANTHROPIC_API_KEY=           # optional, enables Claude models for the canvas steward
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  # Optional: override voice transcription routing (default: realtime)
  VOICE_AGENT_TRANSCRIPTION_MODE=realtime | manual
  ```

- Optional canvas steward controls:

  ```
  CANVAS_STEWARD_MODEL=claude-haiku-4-5        # override the default model (falls back if provider unavailable)
  CANVAS_STEWARD_SERVER_EXECUTION=false        # set true to run the server-side steward alongside the browser agent
  NEXT_PUBLIC_CANVAS_AGENT_CLIENT_ENABLED=true # set false to disable the browser TLDraw agent (use server execution only)
  CANVAS_STEWARD_DEBUG=false                   # set true to dump prompts/actions to the server logs
  ```

### Running the Application

#### Development Mode (Recommended)

Run in three terminals (new architecture):

**Terminal 1 - Voice Agent (Realtime, start first):**

```bash
npm run agent:realtime
```

**Terminal 2 - Conductor (Agents SDK):**

```bash
npm run agent:conductor
```

**Terminal 3 - Next.js App:**

```bash
npm run dev
```

Visit `http://localhost:3000`

> Important: Start the agents before the web app to ensure proper connection.

**Optional - TLDraw Sync Server:**

```bash
npm run sync:dev
```

Runs the local TLDraw sync server so the canvas stays in sync across sessions.

#### Launch Entire Stack at Once

Prefer running everything in the background? Use the helper script:

```bash
npm run stack:start
```

This boots `livekit-server --dev` (as `lk:server:dev`), `sync:dev`, `agent:conductor`, `agent:realtime`, and `next dev` concurrently, writing output to `logs/*.log` so you can tail the services you care about.

To stop all background services cleanly, run:

```bash
npm run stack:stop
```

The script reads the PID files in `logs/` and terminates each dev process, removing stale entries along the way.

#### Production Mode

**Terminal 1 - Voice Agent:**

```bash
npm run agent:realtime
```

**Terminal 2 - Conductor:**

```bash
npm run agent:conductor
```

**Terminal 3 - Next.js App:**

```bash
npm run build    # Build once
npm run start    # Run production server
```

## 📱 Key Features & Pages

- **`/`** - Landing page with setup checklist
- **`/chat`** - custom AI chat interface with MCP integration
- **`/voice`** - Voice assistant with speech-to-text display
- **`/canvas`** - Interactive canvas with voice agent integration
- **`/mcp-config`** - Configure MCP servers
- **`/demo/live-captions`** - Real-time transcription demo
- **`/demo/presentation-deck`** - Interactive presentation system
- **`/demo/livekit-toolbar`** - LiveKit UI components testing

### Configure Model Context Protocol (MCP) Servers

Navigate to `http://app.present.best/mcp-config` to add MCP servers.

For the demo above we used smithery.ai's [brave-search-mcp](https://smithery.ai/server/@mikechao/brave-search-mcp)

![brave-search-mcp](./brave-search-mcp.png)

You can use any MCP compatible server that supports SSE or HTTP.

Our MCP config page is built using the custom-ai/react/mcp package:

```tsx
// In your chat page
<customProvider
  apiKey={process.env.NEXT_PUBLIC_custom_API_KEY!}
  components={components}
>
  <customMcpProvider mcpServers={mcpServers}>
    <MessageThreadFull contextKey="custom-template" />
  </customMcpProvider>
</customProvider>
```

In this example, MCP servers are stored in browser localStorage and loaded when the application starts.

You could have these servers be stored in a database or fetched from an API.

For more detailed documentation, visit [custom's official docs](https://custom.co/docs).

## Customizing

### Change what components custom can control

You can see how the `Graph` component is registered with custom in `src/lib/custom.ts`:

```tsx
const components: customComponent[] = [
  {
    name: "Graph",
    description:
      "A component that renders various types of charts (bar, line, pie) using Recharts. Supports customizable data visualization with labels, datasets, and styling options.",
    component: Graph,
    propsSchema: graphSchema, // zod schema for the component props
  },
  // Add more components
];
```

You can find more information about the options [here](https://custom.co/docs/concepts/registering-components)

### Canvas branding (TLDraw defaults and tiny UI tweaks)

Set TLDraw’s default look-and-feel and a few tasteful UI tweaks via a focused hook.

- Hook: `src/components/ui/canvas/hooks/useTldrawBranding.ts`
- Used at: `src/components/ui/canvas/canvas-space.tsx:~280` (passed to `onMount`)

What it sets by default

- “Next shape” defaults on editor mount: `font: 'sans'`, `size: 'm'`, `dash: 'solid'`, `color: 'violet'`.
- Optional: remap built-in color names (e.g., change what “violet” points to), and nudge selection highlight via CSS variables.

Change the defaults

Edit the `useTldrawBranding` call in `src/components/ui/canvas/canvas-space.tsx` and pass your preferences:

```ts
// src/components/ui/canvas/canvas-space.tsx
const branding = useTldrawBranding({
  defaultFont: 'serif',     // 'draw' | 'mono' | 'sans' | 'serif'
  defaultSize: 'm',         // 's' | 'm' | 'l' | 'xl'
  defaultDash: 'solid',     // 'solid' | 'dashed' | 'dotted'
  defaultColor: 'violet',   // see TLColor union in the hook
  palette: {
    violet: '#6a5acd',      // optional: remap built-in named colors
    blue: '#2563eb',
  },
  selectionCssVars: {
    '--tl-color-selection': '#7b66dc33',
    '--tl-color-selection-stroke': '#7b66dc',
  },
})
```

Scope & notes

- Uses TLDraw v4 Editor APIs (`editor.setStyleForNextShapes`) and v4 theme palette (`DefaultColorThemePalette`).
- Palette remaps apply once per page load and affect all canvases on the page (intended).
- For deeper menu/control edits, compose TLDraw `components` and `overrides`. We already apply collaboration overrides at `src/components/ui/tldraw/utils/collaborationOverrides.ts`.

## 🎙️ Voice + Steward Architecture

The production pipeline now runs as two lightweight Node processes plus the client dispatcher:

1. **Voice Agent (Realtime)** – `src/lib/agents/realtime/voice-agent.ts`
   - Uses the LiveKit Agents Realtime API.
   - Listens to room audio, transcribes, and calls exactly two UI tools: `create_component` and `update_component`.
   - Can optionally hand off server-side work by calling `dispatch_to_conductor`.
   - Supports two transcription modes. By default the agent relies on the realtime model's native speech recognition. Set `VOICE_AGENT_TRANSCRIPTION_MODE=manual` to route transcripts from the client data channel instead (legacy behaviour).

2. **Conductor + Stewards** – `src/lib/agents/conductor/` and `src/lib/agents/subagents/`
   - Conductor is a tiny router (Agents SDK) that delegates to domain stewards via handoffs.
   - Stewards (e.g., Flowchart Steward) read state from Supabase, reason holistically, and emit one structured UI patch or component creation. Flowchart commits trigger `/api/steward/commit`, which broadcasts the update over LiveKit.

3. **Browser ToolDispatcher** – `src/components/tool-dispatcher.tsx`
   - Executes the two UI tools, updates TLDraw or React components, and returns `tool_result`/`tool_error` events.
   - All other logic (diagram merging, lookups, narration) lives in stewards.

Legacy docs for the original `livekit-agent-worker.ts` / three-agent setup now live in `docs/THREE_AGENT_ARCHITECTURE.md` under the archived section.

### Project Structure

```
src/
├── lib/
│   ├── livekit-agent-worker.ts  # Voice Agent (Agent #1)
│   ├── decision-engine.ts       # Decision Engine (Agent #2)
│   ├── system-registry.ts       # Single source of truth
│   └── shared-state.ts          # State synchronization types
├── components/
│   ├── tool-dispatcher.tsx      # Tool Dispatcher (Agent #3)
│   └── ui/                      # custom components
└── app/                         # Next.js pages
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## 📄 License

This project is licensed under the MIT License.

### Supabase Session Sync

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`.
Create a `canvas_sessions` table to track each meeting session canvas:

```sql
create table if not exists public.canvas_sessions (
  id uuid primary key default uuid_generate_v4(),
  canvas_id uuid references public.canvases(id),
  room_name text not null,
  participants jsonb not null default '[]',
  transcript jsonb not null default '[]',
  canvas_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists canvas_sessions_room_canvas_uidx
  on public.canvas_sessions(room_name, canvas_id);
```

The headless `SessionSync` component will insert/update this row and stream:

- LiveKit participants
- LiveKit `transcription` bus messages
- TLDraw canvas snapshot on save

#### RLS and triggers (recommended)

```sql
-- Enable RLS
alter table public.canvas_sessions enable row level security;

-- Example policy: user can read rows where the linked canvas belongs to them
-- Adjust to your auth schema; this assumes canvases.user_id = auth.uid()
create policy if not exists canvas_sessions_read_own
  on public.canvas_sessions
  for select
  using (
    canvas_id is null
    or exists (
      select 1 from public.canvases c
      where c.id = canvas_id and c.user_id = auth.uid()
    )
  );

-- Example write policy: allow owner to update
create policy if not exists canvas_sessions_update_own
  on public.canvas_sessions
  for update
  using (
    canvas_id is null
    or exists (
      select 1 from public.canvases c
      where c.id = canvas_id and c.user_id = auth.uid()
    )
  );

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_canvas_sessions_updated_at on public.canvas_sessions;
create trigger set_canvas_sessions_updated_at
before update on public.canvas_sessions
for each row execute function public.set_updated_at();
```
