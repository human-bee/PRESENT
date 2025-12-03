# Linear MCP Integration

This document outlines the architecture and pipeline for the Linear MCP integration in PRESENT.

## Architecture Overview

The integration connects to Linear's hosted MCP server via HTTP (`https://mcp.linear.app/mcp`). It uses a "Generic Delegation" pattern where the Voice Agent delegates all Linear-related tasks to a specialized sub-agent (`LinearKanbanBoard` + `LinearSteward`).

### Key Components

1.  **`LinearMcpClient` (`src/lib/linear-mcp-client.ts`)**:
    *   **Role**: A "dumb" HTTP client responsible ONLY for the MCP protocol (tools/list, tools/call) and authentication.
    *   **Auth**: Sends the user's Linear API key in the `Authorization: Bearer <token>` header.
    *   **No Logic**: Does NOT interpret natural language or guess tool names.

2.  **`LinearSteward` (`src/lib/agents/subagents/linear-steward-fast.ts`)**:
    *   **Role**: A fast LLM agent (Groq/Cerebras) that interprets natural language instructions.
    *   **Output**: Returns **Structured Actions** (JSON) that map user intent to specific MCP tool calls.

3.  **`LinearKanbanBoard` (`src/components/ui/productivity/linear-kanban-board.tsx`)**:
    *   **Role**: The UI component that manages the board state, optimistic updates, and sync queue.
    *   **Pipeline**: Receives instructions -> Calls Steward -> Applies Optimistic Update -> Triggers MCP Call.

## Detailed Pipelines

### 1. Initial Board Load
*   **Trigger**: Component mount.
*   **Flow**:
    1.  `LinearKanbanBoard` initializes `useComponentSubAgent`.
    2.  `dataEnricher` (defined in `subAgentConfig`) is called.
    3.  `dataEnricher` calls `tools.linear.execute('linear_issues_search', { query: ... })`.
    4.  `LinearMcpClient` sends a `tools/call` request to the Linear MCP server.
    5.  Results are returned and populated into `state.issues`.

### 2. Voice / Natural Language Update
*   **Trigger**: User says "Move task X to Done".
*   **Flow**:
    1.  **Voice Agent**: Identifies the intent and calls `update_component(id, { instruction: "Move task X to Done" })`.
    2.  **Registration**: `useComponentRegistration` receives the update and calls `processInstruction` in `LinearKanbanBoard`.
    3.  **Steward**: `processInstruction` calls the `/api/ai/linear-steward` endpoint.
    4.  **Interpretation**: `LinearSteward` analyzes the text and returns a `LinearStewardAction` (e.g., `{ kind: 'moveIssue', issueId: '...', toStatus: 'Done', mcpTool: { name: 'linear_issue_update', args: { ... } } }`).
    5.  **Optimistic Update**: `LinearKanbanBoard` immediately updates the UI state (moves the card).
    6.  **Pending Queue**: A new entry is added to `state.pendingUpdates` with status `pending`.
    7.  **Sync**: The component triggers `subAgent.trigger({ action })`.
    8.  **Execution**: The sub-agent executes the `mcpTool` defined in the action via `LinearMcpClient`.
    9.  **Completion**: On success, the pending item is marked `synced`. On failure, it is marked `failed`.

### 3. Manual UI Actions (Drag & Drop)
*   **Trigger**: User drags a card to a new column.
*   **Flow**:
    1.  **Handler**: `handleDrop` is triggered.
    2.  **Optimistic Update**: The UI updates immediately to show the card in the new column.
    3.  **Queue**: A pending update is added to `state.pendingUpdates`.
    4.  **Sync**: The component calls `LinearMcpClient` directly (or via a helper) to execute the update.
    5.  **Feedback**: Success/Failure is reflected in the "Pending Changes" dropdown.

## Security Note

*   **API Key**: The Linear API key is stored in the user's local browser storage (via the Kanban settings UI) and passed to the server-side proxy via headers.
*   **Transmission**: The key is sent as `X-Linear-Key` (or `Authorization`) to the proxy, which forwards it to Linear.
*   **Future**: We plan to move to OAuth 2.0 to avoid handling raw API keys and to provide a better user experience.

## Future Work

*   **OAuth Integration**: Implement full OAuth flow for secure authentication.
*   **Project Filtering**: Allow users to filter issues by Linear project.
*   **Two-Way Sync**: Implement polling or webhooks to reflect changes made in Linear back to the board in real-time.
*   **Rich Metadata**: Display more issue details (assignee avatars, priority icons) on the cards.
