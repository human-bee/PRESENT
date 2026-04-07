# MCP Apps in PRESENT

This repo includes first‑class support for MCP Apps (tool‑paired UI views rendered in a sandboxed iframe). MCP Apps are spawned via the existing `create_component` / `update_component` tool surface, so the voice agent still only needs those two tools.

## Quick start

1. Add your MCP server(s) in `/mcp-config` (stored in localStorage).
2. Create a widget:

```ts
create_component({
  type: 'McpAppWidget',
  spec: {
    toolName: 'weather_forecast',
    serverName: 'Local MCP',
    autoRun: true
  }
})
```

3. To mirror canonical roadmap timeline state into an MCP app surface, point the widget at the timeline document:

```ts
create_component({
  type: 'McpAppWidget',
  spec: {
    title: 'Timeline Roadmap',
    resourceUri: '/mcp-apps/timeline.html',
    syncSource: 'timeline',
    syncRoom: 'canvas-<canvas-id>',
    syncComponentId: '<timeline-widget-component-id>',
    syncIntervalMs: 2500,
  }
})
```

## How it works

- The host resolves the MCP tool metadata (`_meta.ui.resourceUri`) and loads the UI resource.
- The UI is rendered in an iframe with a minimal sandbox (`allow-scripts`).
- The host bridges tool input/results to the view using `AppBridge` + `PostMessageTransport`.
- Apps can send `ui/update-model-context`, which the host stores as a Context Document.

## Widget props

- `toolName`: MCP tool to call.
- `serverName` / `serverUrl`: which MCP server to use.
- `resourceUri`: optional override for UI resource.
- `args`: tool arguments.
- `syncSource`: canonical sync source. Timeline uses `'timeline'`.
- `syncRoom`: room used for canonical timeline lookup (`canvas-<id>`).
- `syncComponentId`: timeline component id to read.
- `syncIntervalMs`: polling cadence (1000-30000ms, default 3000).
- `autoRun`: run on mount.
- `runId`: change to force a re‑run.
- `displayMode`: requested display mode (`inline`, `panel`, `modal`).

## Security

- Requested permissions from `_meta.ui.permissions` are translated into iframe `allow=""`.
- CSP from `_meta.ui.csp` is injected into the HTML.

## Notes

- If your MCP server does not support `resources/read` over HTTP, use the MCP proxy or update server transport.
- Context updates from apps are stored in Context Documents (visible to the summary/infographic stewards).
- Canonical timeline reads are available at `GET /api/steward/timeline?room=<room>&componentId=<id>` (auth + canvas membership required, except non-production dev bypass when `NEXT_PUBLIC_CANVAS_DEV_BYPASS=true`).
- Timeline mutations enqueue through `POST /api/steward/runTimeline` and converge on the same canonical document used by the widget host.
