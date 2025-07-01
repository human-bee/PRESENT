# Tambo Voice AI Application

A sophisticated Next.js application that combines Tambo AI's generative UI capabilities with LiveKit's real-time voice agents and Model Context Protocol (MCP) integration.

## 🎯 Features

- **Voice-Enabled AI Agent**: Real-time voice interactions powered by LiveKit and OpenAI
- **Generative UI Components**: Dynamic UI generation through Tambo AI
- **MCP Integration**: Connect to various AI tools and services via Model Context Protocol
- **Multi-Modal Interactions**: Support for both chat and voice interfaces
- **Canvas Collaboration**: Interactive canvas with AI-generated components
- **Demo Showcases**: Live captions, presentation deck, and toolbar demonstrations

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- Valid API keys for:
  - Tambo AI
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
  NEXT_PUBLIC_TAMBO_API_KEY=
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
- **`/chat`** - Tambo AI chat interface with MCP integration
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

Our MCP config page is built using the tambo-ai/react/mcp package:

```tsx
// In your chat page
<TamboProvider
  apiKey={process.env.NEXT_PUBLIC_TAMBO_API_KEY!}
  components={components}
>
  <TamboMcpProvider mcpServers={mcpServers}>
    <MessageThreadFull contextKey="tambo-template" />
  </TamboMcpProvider>
</TamboProvider>
```

In this example, MCP servers are stored in browser localStorage and loaded when the application starts.

You could have these servers be stored in a database or fetched from an API.

For more detailed documentation, visit [Tambo's official docs](https://tambo.co/docs).

## Customizing

### Change what components tambo can control

You can see how the `Graph` component is registered with tambo in `src/lib/tambo.ts`:

```tsx
const components: TamboComponent[] = [
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

You can find more information about the options [here](https://tambo.co/docs/concepts/registering-components)

## 🎙️ Voice Agent Architecture

The voice agent runs as a separate Node.js process using the LiveKit Agents framework:

- **Agent Worker**: `src/lib/livekit-agent-worker.ts` - TypeScript-based agent using OpenAI Realtime API
- **Automatic Dispatch**: Agent automatically joins any room created in your LiveKit project
- **Real-time Transcription**: Live speech-to-text displayed in the UI
- **Tool Support**: Extensible tool system in `src/lib/livekit-agent-tools.ts`

The agent connects via WebRTC for low-latency voice interactions and publishes transcriptions back to the room.

## 🏗️ Architecture

### Three-Agent System

Tambo uses a sophisticated **3-agent architecture** for intelligent voice-driven UI generation:

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
   - Executes via Tambo UI, MCP tools, or built-in functions
   - Syncs available tools to SystemRegistry
   - Returns results to Voice Agent

All three agents stay synchronized through the **SystemRegistry** - a single source of truth for available capabilities. When you add new MCP tools or Tambo components, all agents automatically discover and can use them without code changes.

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
│   └── ui/                      # Tambo components
└── app/                         # Next.js pages
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## 📄 License

This project is licensed under the MIT License.