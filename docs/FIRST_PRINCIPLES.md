# First Principles

## What Needs Doing First

- Merge branches – **DONE**
- Figure out what needs doing – **DONE**
- TLDraw sub-agent
- Conductor agent that takes all tools
- Expose TLDraw agent and conductor to the primary agent as tool calls

## 1. One LiveKit Agent Per User (`livekit-agent-worker.ts`)

- Agents should be able to initialize custom components, create TLDraw shapes, or manipulate the canvas through tool calls.
- **Available tools:**
  - Canvas subagent (natural language → TLDraw editor API calls)
  - Pass off component creation to the conductor agent
  - Pass off component update to the conductor agent

## 2. One Room With Multiple Participants

- **DONE**

## 3. Canvas Syncs State Between Participants

- **DONE**

## 5. Sub-Agent: Conductor Agent

- Acts on instructions from the watcher or primary agent to perform actions.
- Has access to all MCP tools (e.g., Linear, YouTube).
- Interprets natural language instructions and uses its toolbox to update components.
- Can call MCPs to fetch real-time external information (e.g., YouTube API).
- Renders components with pre-existing props and can update their state.
- Receives tool call arguments and uses transcript context to determine user intent.
- Specialized mini agents (e.g., a Linear agent) may be used for specific components, streaming real-time updates to their respective components based on progreessing transcript and canvas interactions.
- The LiveKit agent currently monitors the transcript and decides when to update component state accordingly.

## 6. Watcher Agent

- Monitors the transcript and decides if a component should be updated based on the transcript
- Sends a message to the conductor agent to update the component

## Principles

- Real-time speech-to-UI platform
- Receives transcript from the user and from other users
- Initializes components and controls the canvas
- Receives text input from user messages
- All Agents should follow the principles and guidelines of OpenAI's [JS Agent SDK](https://openai.github.io/openai-agents-js/), [Realtime API] (<https://platform.openai.com/docs/guides/realtime>) and [Responses API](https://platform.openai.com/docs/api-reference/responses)
