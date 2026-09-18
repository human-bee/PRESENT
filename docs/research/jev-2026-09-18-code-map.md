# Jev integration code map (2026-09-18)

## Recommendation

Put the first Jev proof at the existing server-side fairy intent decision seam, `src/lib/fairy-intent/router.ts:65`. Jev should answer one narrow typed question: **`canvas` or `defer`**. A high-confidence `canvas` result returns the existing `FairyRouteDecision` with the user's original message unchanged. `defer`, low confidence, timeout, malformed response, missing `TYPESAFE_API_KEY`, or any HTTP error immediately uses the current Cerebras router. Place the Jev call after the existing `!isFastStewardReady()` return so today's zero-model fallback gains no network hop. This replaces a bounded decision when Jev is useful and avoids inventing rich widget props, free-form text, view details, or bundle actions that Jev cannot generate.

Do not insert Jev in `voice-agent.ts`, the LiveKit tool stream, browser ToolDispatcher, widget state, or reset turn APIs. Those are downstream of routing and would add a network hop to every mutation. Do not expose the TypeSafe key to the browser.

## Current path, verified from code

```text
/ -> /canvas
CanvasPageClient + LiveKit room
  -> realtime voice agent normalizes/publishes a tool event
  -> dispatch_to_conductor(task = fairy.intent)
  -> queued conductor worker
  -> conductor router handleFairyIntent
       deterministic starter-room / forced-canvas shortcuts
       otherwise routeFairyIntent (current Cerebras tool-call router)
  -> steward or direct route action
  -> LiveKit create_component/update_component event
  -> browser ToolDispatcher validates the registered Zod schema
  -> TLDraw custom shape state
  -> lazy WidgetRuntimeRenderer React component
```

Evidence:

- `src/app/page.tsx:23-34` redirects to `/canvas`; `src/app/canvas/page.tsx:1-17` mounts `CanvasPageClient`.
- `src/lib/agents/realtime/voice-agent.ts:2649-2661` is the server tool-call normalization boundary; publishing occurs around `:3279-3346`.
- `src/lib/agents/conductor/router.ts:1120-1137` takes deterministic starter-room and forced-canvas shortcuts, then calls `routeFairyIntent`; `:2565-2567` proves queued `fairy.intent` tasks use this handler when the native realtime/conductor stack is running.
- `src/lib/fairy-intent/router.ts:65-305` currently calls Cerebras with a tool schema, extracts raw tool arguments, then validates `FairyRouteDecisionSchema`. This is the redundant bounded decision/JSON generation cost Jev can remove.
- `src/components/tool-dispatcher/hooks/useToolEvents.ts:211-330` receives LiveKit component updates; `useToolRegistry.ts:342-535` validates and applies component create/update calls.
- `src/lib/tools/conductor/components/registry.tsx:75-90,128-305` owns component Zod schemas; `src/components/ui/tldraw/canvas/components/widget-runtime-registry.ts:10-152` maps names to lazy React renderers. These remain unchanged for the narrow proof.

## Reset versus native runtime

The repository instructions call reset the default, and `dev:reset` exists, but current executable routing still serves the native canvas shell:

- `package.json:27` makes `dev:reset` an alias for ordinary Next dev.
- The root page redirects to `/canvas`, which renders `CanvasPageClient`.
- `packages/ui/src/reset-workspace-shell.tsx` exports `ResetWorkspaceShell`, but no application route imports or mounts it. It is currently a tested package surface, not the live page.
- Reset APIs and Codex queue work (`src/app/api/reset/**`, `services/codex-adapter/**`) are active supporting surfaces, especially for `CodexRemoteWidget`, but they are not the generative UI render hot path.

Therefore the first Jev integration belongs in the native server conductor route, not the reset workspace shell. It is reachable in the production long-lived realtime/conductor services and the archived local LiveKit stack; `npm run dev:reset` by itself does not start either agent process. The experiment proves the native path only and does not accelerate a standalone reset-shell session.

## Minimal implementation contract

### Owner A: TypeSafe adapter

Exclusive files:

- new `src/lib/fairy-intent/jev-router.ts`
- No tests added or run, per the user request.

Responsibilities:

1. Use direct `fetch` to `POST https://api.typesafe.ai/v1/systemone`; avoid adding an SDK dependency for a one-question proof.
2. Send compact state: original request, source, whether selection/bounds/component scope exists. Ask one `Choice` question with only `canvas` and `defer`.
3. Return a discriminated local result containing choice, confidence, probabilities, provider request id if present, and measured latency. Never return a `FairyRouteDecision` from the adapter.
4. Read `TYPESAFE_API_KEY` only on the server. Missing key returns `unavailable` synchronously.
5. Bound the request with an abort timeout (fixed 300 ms for this POC) and treat every failure as `unavailable`; never throw through the conductor.
6. Future evidence, not run in this POC: high-confidence canvas, defer, low-confidence, timeout, HTTP error, malformed payload, and absent key.

### Owner B: router seam and telemetry

Exclusive files:

- `src/lib/fairy-intent/router.ts`
- Optional `src/lib/fairy-intent/jev-router-telemetry.ts` helper and `example.env.local`.

Responsibilities:

1. Preserve the current implementation as the fallback function without changing its prompt, schema, or output handling.
2. After the existing `!isFastStewardReady()` early return in exported `routeFairyIntent`, call Owner A's adapter. Only `choice === 'canvas'` at or above the experiment threshold (`0.95`), with finite valid probabilities, may return early:

   ```ts
   { kind: 'canvas', confidence, message: intent.message }
   ```

3. Every other result calls the existing router. Do not synthesize `componentType`, `roomTemplate`, `fastLaneEvent`, `fastLaneDetail`, `actions`, `summary`, or rewritten text.
4. Record provider, model `jev-latest`, latency, choice/probabilities/confidence, threshold outcome, and fallback reason through the existing replay telemetry functions. Do not log secrets or a full sensitive canvas snapshot.
5. Future evidence, not run in this POC: Jev high-confidence canvas skips Cerebras; defer/low-confidence/unavailable preserve the exact prior call and result; original message survives byte-for-byte.

Merge order: Owner A first, then Owner B. The only shared contract is the adapter return type, agreed before either worker edits. Neither worker should touch `conductor/worker.ts` or the browser/component registry.

## Latency and success proof

Use current replay/benchmark inputs, not a new end-to-end UI architecture. Compare current router versus Jev-primary on the same labeled intents:

- decision p50/p95 and end-to-end time to first visible canvas action;
- proportion of calls resolved by Jev versus fallback;
- false-canvas rate (more costly than defer), timeout/error rate, and downstream task-contract success;
- full probabilities and confidence calibration by bucket.

Ship criteria for the proof: zero false-canvas regressions in the labeled set, fallback behavior identical to current routing, and a material p50 improvement for Jev-resolved requests. A TypeSafe key is not present locally as of this review, so live latency cannot be claimed yet.

## Branch, dirty state, and deployment

- Current checkout: `codex/fromscratch` at `f60fd7d`.
- Verified remote production source: `origin/main` at `78166042ac06a6886c86292715de61760e906382` (PR 189 auth-loading hotfix).
- Working tree at review: 157 modified tracked files and 130 untracked paths. `src/lib/fairy-intent/router.ts` and `router-schema.ts` are clean relative to `HEAD`; `src/lib/agents/conductor/worker.ts` is locally modified.
- The current fairy router differs from `origin/main` by earlier committed starter-room/scope work. The narrow Jev proof needs that current router behavior preserved, but it does not require the unrelated 287 dirty paths.
- The checked-in Railway workflow deploys only from `main` by `.github/workflows/deploy-railway-prod.yml:1-18`; agent changes select the conductor/realtime jobs. Manual workflow dispatch from non-main is explicitly zeroed in the plan. The web app is separately described/configured as Vercel; the Railway workflow covers long-lived agents and Codex services.

Do not deploy or open a PR directly from this dirty checkout. Create an isolated branch/worktree from the intended base, bring forward only the already-committed fairy-router prerequisites if they are not yet on `main`, then apply the two-owner Jev patch. Existing uncommitted local changes are not needed for the Jev proof. The implementation is independently deployable as a conductor-only change once merged to `main`; the browser and widget catalog need no deploy-coupled change.

## Go / no-go

Go for preparing and delivering the two-file-area integration now; activation and live latency evidence require API access. No-go for a broad “Jev generates PRESENT UI” integration: Jev is a typed classifier, and the current component schema/render/stream path should stay authoritative.

Release correction: fairy-intent files are outside the workflow automatic path filters. A merged patch needs manual main dispatch with force_conductor=true. No earlier starter-room/scope feature is required by the narrow canvas result; apply only the new hook to the existing main router.
