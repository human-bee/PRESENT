# Unified Search Steward Specification

## Overview
A dedicated Search Steward orchestrates all evidence-gathering tasks (generic web, YouTube, canvas-context lookups) so realtime voice agents and other stewards can offload heavyweight retrieval without inflating their own context windows.

## Responsibilities
- Normalize user queries into structured search intents.
- Fan out to provider-specific tools (`web_search`, YouTube Data API, Supabase canvas metadata) with shared rate limiting/caching.
- Emit structured responses that consumer stewards (Debate, Canvas, ResearchPanel) can map directly to UI updates.

## Tasks
1. `search.general`
   - **Params**: `{ room, query, maxResults?, freshness?, componentId?, promptContext? }`
   - **Tools**: `web_search` (Responses API) + optional MCP connectors.
   - **Returns**: `SearchBundle` (see schema) with `hits`, `summary`, `citations`.
   - **Consumers**: Debate steward (fact checks), ResearchPanel component.
2. `search.youtube`
   - **Params**: `{ room, query, maxResults?, durationFilter?, channelHint? }`
   - **Tools**: YouTube Data API via cached proxy.
   - **Returns**: `VideoBundle` (id, title, channel, startTime suggestions).
   - **Consumers**: Voice agent (to spawn `YoutubeEmbed`), Media/Canvas stewards.
3. `search.canvas_context`
   - **Params**: `{ room, selectionIds?, bbox?, keywords? }`
   - **Tools**: TLDraw store (via Supabase) + embeddings for shape text.
   - **Returns**: `CanvasContextBundle` (nearby shapes, annotations, suggested follow-ups).
   - **Consumers**: Canvas steward, Flowchart steward.

## Response Schema
```ts
interface SearchBundle {
  requestId: string;
  query: string;
  summary: string;
  hits: Array<{
    id: string;
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
    source?: string;
    embeddingId?: string;
  }>;
  citations: string[]; // hit IDs referenced in summary order
  model: string;
  latencyMs: number;
}
```
Video and canvas bundles extend this base with modality-specific fields.

## UI Hooks
- **ResearchPanel component**: accepts `SearchBundle` props to render cards with citations + follow-up actions.
- **Flowchart annotations**: `search.canvas_context` results streamed into TLDraw nodes via Canvas steward.
- **Debate scorecard**: steward consumes `search.general` hits to populate `sources[]` and `factChecks[]`.

## Latency Targets
- SLA 800 ms P95 for cached/general queries; 1.2 s for uncached multi-provider lookups.
- Pre-warm search steward workers with provider tokens; maintain shared LRU cache keyed by `{query,freshness}`.

## Security & Billing
- All external API credentials live in steward process env; voice agent never handles them directly.
- Implement query auditing + allowlist per room to avoid arbitrary scraping when enterprise flags are set.

## Rollout Plan
1. Build `searchSteward` (Agents SDK) exposing the three tasks above.
2. Update conductor to route `search.*` tasks similarly to `scorecard.*`.
3. Teach voice agent + other stewards to dispatch search tasks instead of direct provider calls.
4. Once verified, deprecate bespoke `youtube_search`/`web_search` tools in capabilities in favor of the steward interface.
