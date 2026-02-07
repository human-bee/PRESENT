# Vector Memory MCP (Summaries → Vector Store)

This app can auto-send meeting summaries to a vector-memory MCP tool for long-term recall.

## How it works
- `MeetingSummaryWidget` emits a **memory payload** whenever the summary is sent.
- Payloads are adapted for common vector MCP tools:
  - `qdrant-store` → `{ information, metadata, collection_name? }`
  - `upsert-records` → `{ records: [{ id, text, metadata }], index?, namespace? }`
- If your MCP server expects a different schema, set a custom tool name and adjust the widget payload fields accordingly.

## Env knobs
```
SUMMARY_MEMORY_MCP_TOOL=qdrant-store
SUMMARY_MEMORY_MCP_COLLECTION=present-memory
SUMMARY_MEMORY_MCP_INDEX=present-memory
SUMMARY_MEMORY_MCP_NAMESPACE=present
SUMMARY_MEMORY_AUTO_SEND=false
NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_TOOL=qdrant-store
NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_COLLECTION=present-memory
NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_INDEX=present-memory
NEXT_PUBLIC_INFOGRAPHIC_MEMORY_MCP_NAMESPACE=present
NEXT_PUBLIC_INFOGRAPHIC_MEMORY_AUTO_SEND=false
NEXT_PUBLIC_MEMORY_RECALL_MCP_TOOL=qdrant-find
NEXT_PUBLIC_MEMORY_RECALL_MCP_COLLECTION=present-memory
NEXT_PUBLIC_MEMORY_RECALL_MCP_INDEX=present-memory
NEXT_PUBLIC_MEMORY_RECALL_MCP_NAMESPACE=present
NEXT_PUBLIC_MEMORY_RECALL_AUTO_SEARCH=true
```

## MCP config
1) Start your MCP server (e.g. Qdrant MCP or Pinecone MCP).
2) Open `/mcp-config` and add the server URL.
3) Verify the tool name matches `SUMMARY_MEMORY_MCP_TOOL`.
4) Use the MeetingSummaryWidget "Send" button (or enable `SUMMARY_MEMORY_AUTO_SEND`).

## Memory Recall Widget
- Create via `create_component` with type `MemoryRecallWidget`.
- Set `query` (and optionally `autoSearch=true`) to run a memory lookup.
- The widget calls `NEXT_PUBLIC_MEMORY_RECALL_MCP_TOOL` (default `qdrant-find`).

## Local Qdrant MCP (recommended)
1) Start Qdrant (local or container).
2) Run the official MCP server with a local Qdrant path or a Qdrant URL:
   - Local embedded Qdrant:
     - `QDRANT_LOCAL_PATH=/path/to/qdrant-data`
     - `COLLECTION_NAME=present-memory`
     - `uvx mcp-server-qdrant --transport sse`
   - External Qdrant:
     - `QDRANT_URL=http://localhost:6333`
     - `COLLECTION_NAME=present-memory`
     - `uvx mcp-server-qdrant --transport sse`
3) Add the MCP server URL (printed on startup) to `/mcp-config` and click **Verify & Map**.

## Tool compatibility notes
- **Qdrant MCP** exposes `qdrant-store` + `qdrant-find`, expects `information` + `metadata` + `collection_name`.
- **Pinecone MCP** exposes `upsert-records` + `search-records` and requires an index with **integrated inference**.

## Customization
You can override the target per-summary via metadata:
- `metadata.summaryMcpTool` or `metadata.crmToolName`
- `metadata.memoryCollection`, `metadata.memoryIndex`, `metadata.memoryNamespace`
