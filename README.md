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
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_ANON_KEY=
  ```

4. **Build the agent (TypeScript)**

```bash
npm run agent:build
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

#### Production Mode

```bash
npm run build
npm run agent:build
npm start          # Terminal 1
npm run agent:run  # Terminal 2
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

## 🎙️ Voice + Steward Architecture

The production pipeline now runs as two lightweight Node processes plus the client dispatcher:

1. **Voice Agent (Realtime)** – `src/lib/agents/realtime/voice-agent.ts`
   - Uses the LiveKit Agents Realtime API.
   - Listens to room audio, transcribes, and calls exactly two UI tools: `create_component` and `update_component`.
   - Can optionally hand off server-side work by calling `dispatch_to_conductor`.

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
