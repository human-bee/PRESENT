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

Run in two terminals:

**Terminal 1 - Voice Agent (start first):**

```bash
npm run agent:dev
```

**Terminal 2 - Next.js App:**

```bash
npm run dev
```

Visit `http://localhost:3000`

> **Important**: Always start the agent before the web app to ensure proper connection.

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

Navigate to `http://localhost:3000/mcp-config` to add MCP servers.

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

## 🎙️ Voice Agent Architecture

The voice agent runs as a separate Node.js process using the LiveKit Agents framework:

- **Agent Worker**: `src/lib/livekit-agent-worker.ts` - TypeScript-based agent using OpenAI Realtime API
- **Automatic Dispatch**: Agent automatically joins any room created in your LiveKit project
- **Real-time Transcription**: Live speech-to-text displayed in the UI
- **Tool Support**: Extensible tool system in `src/lib/livekit-agent-tools.ts`

The agent connects via WebRTC for low-latency voice interactions and publishes transcriptions back to the room.

## 🏗️ Architecture

### Three-Agent System

custom uses a sophisticated **3-agent architecture** for intelligent voice-driven UI generation:

1. **🎙️ LiveKit Voice Agent** (`livekit-agent-worker.ts`)
   - Captures and transcribes voice input
   - Manages conversation flow
   - Queries available tools/components dynamically
   - Publishes tool calls to the browser

2. **🧠 Decision Engine** (`decision-engine.ts`)
   - Embedded within the Voice Agent
   - Analyzes transcriptions for actionable requests
   - Maintains 30-second conversation context
   - Uses GPT-4 for intelligent filtering
   - Detects intent (YouTube search, UI component, etc.)

3. **🔧 Tool Dispatcher** (`tool-dispatcher.tsx`)
   - Runs in the browser as a React component
   - Routes tool calls to appropriate handlers
   - Executes via custom UI, MCP tools, or built-in functions
   - Syncs available tools to SystemRegistry
   - Returns results to Voice Agent

All three agents stay synchronized through the **SystemRegistry** - a single source of truth for available capabilities. When you add new MCP tools or custom components, all agents automatically discover and can use them without code changes.

For detailed architecture documentation, see [docs/THREE_AGENT_ARCHITECTURE.md](docs/THREE_AGENT_ARCHITECTURE.md).

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
