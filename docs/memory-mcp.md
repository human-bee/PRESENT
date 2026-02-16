# Vector Memory MCP (Summaries to Vector Store)

This app can send meeting/summary artifacts to a memory MCP tool for long-term recall.

## How it fits the runtime

Memory writes are triggered from supported widget flows and dispatched through MCP tool calls from the app surfaces that own the feature.

- Input intent may originate from voice, but memory side effects are typically executed by the destination widget/surface (not the canvas queue lane).
- Memory payloads are adapted to target MCP tool shape.
- Success/failure should be handled as side-effect status, not destructive primary-state mutation.
- Do not assume `runCanvas` queue traces for memory writes unless a specific feature explicitly routes there.

## Env knobs

```bash
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

## MCP setup

1. Start MCP server (Qdrant/Pinecone-compatible toolset).
2. Configure server in `/mcp-config`.
3. Verify tool names match env settings.
4. Trigger summary/memory actions from supported widget paths.

## Compatibility notes

- Keep tool names and payload contracts additive.
- Do not couple memory write success to critical UI correctness paths.
- Prefer explicit metadata tags (`collection`, `index`, `namespace`) for deterministic routing.
