# Jev: PRESENT architecture decisions

Date: 2026-09-18. Status: implemented and source reviewed; no live Jev result or measured improvement. Inputs: [primary research](jev-2026-09-18-primary.md), [public examples](jev-2026-09-18-examples.md), and the source inspection below. A TypeSafe key is not available locally.

## Decision

Use Jev only where an existing generative model makes a bounded decision. Do not insert it ahead of deterministic routing, queue dispatch, renderer lookup, or every user request. The smallest concrete candidate is the unresolved Fairy intent route in `src/lib/fairy-intent/router.ts`, which currently calls Cerebras to generate a `route_intent` tool result. The code map confirms this is reachable through the current /canvas native realtime/conductor flow. It does not accelerate standalone reset APIs or Codex generation.

`src/lib/agents/conductor/router.ts` already resolves starter-room requests and forced canvas routes before calling `routeFairyIntent`. Preserve these bypasses. The conductor worker's task-name classifier is also deterministic and must remain local. Keep the browser-side canvas agent disabled.

## Executable first slice

After the existing `!isFastStewardReady()` early return in `routeFairyIntent`, ask one Choice question with only `canvas` and `defer`. Placing the call before that check would add a network hop to today's zero-model fallback and is prohibited:

- `canvas`: a single drawing, canvas styling, positioning, or layout request that the canvas steward can execute directly using the unchanged user message.
- `defer`: any request for another widget, a room, view controls, multiple outputs, no action, ambiguous intent, or a route requiring generated arguments.

Supply the message and a compact allowlisted subset of the same context the existing router uses. Do not send arbitrary metadata, full room transcripts, credentials, or canvas documents. Treat supplied text as data. Jev selects a route; it never authors tool arguments, TLDraw actions, component props, or user-facing prose.

An accepted `canvas` result constructs a schema-validated route using the original message and the existing normalized/default context profile, and skips the Cerebras call completely. `defer` executes the original router. No key, original fast-steward-unavailable state, malformed response, timeout, or provider failure preserves the original path. Do not change the original router's canvas fallback or its availability behavior. This is an experimental provider substitution within an existing semantic decision, not a new compatibility branch across the product.

The local proof can consist of a small server-only adapter, a route integration, and an implementation review. Keep modules under the repository's 200-line target; do not broadly refactor the large conductor router. Read the current working diff first and preserve others' edits.

## Confidence and timeout policy

Use a provisional acceptance threshold of `confidence >= 0.95` with `choice === canvas`, valid finite probabilities, a recognized schema, and no contradictory required fields. This is a conservative experiment setting, not a calibrated guarantee. Report confidence bins against human-reviewed labels before adopting it. Any uncertainty follows `defer`; do not ask users to adjudicate routine classifier failures.

Use a 300 ms total local decision budget covering fetch and response validation, with an abort signal and no retry. On exhaustion, invoke the existing router exactly once and ignore late Jev completions. The vendor's stated 70–500 ms range means this budget can intentionally reject slower successes. Benchmark alternative budgets offline; do not present 300 ms as a provider SLA. Repeated service errors should not create retry storms.

No key must cause zero Jev HTTP requests. Existing deterministic branches must cause zero Jev and zero additional Cerebras requests. An accepted Jev answer must cause zero Cerebras router requests. Failures must neither dispatch twice nor change the original message.

## Latency and acceptance evidence

The only latency eligible for removal is the Cerebras routing turn. Successful substitution costs the Jev decision duration instead; fallback adds up to the decision budget before the original turn. With accepted fraction `a`, average overhead is approximately `J - a * R`, where `J` is mean Jev attempt duration and `R` is the displaced router duration for accepted requests. Measure actual paired requests because accepted and deferred cohorts can have different baseline costs.

Record route input-to-decision, queue wait, steward start-to-first-action, action-to-browser acknowledgment, and request-to-first-useful-visible-result separately. Keep provider/model, selected option, confidence, probabilities, outcome, timeout/fallback reason, and correlation IDs. Match existing retention/redaction conventions; do not add raw private payload logging merely for this experiment.

Replay a small labeled corpus including plain canvas requests, widgets, view operations, bundles, rooms, ambiguity, and misleading embedded instructions. Compare existing router and candidate on identical inputs, inspecting the final routed action as well as classification. Require no observed wrong accepted route in the reviewed corpus, a demonstrated reduction in semantic-router p50/p95 for the relevant workload, and no regression in visible completion or duplicate actions. A small zero-error sample is preliminary evidence, not a production accuracy estimate.

Without a key, verify only wiring and invariants using controlled responses: accepted route skips Cerebras; deferred/invalid/low-confidence/HTTP-error/timeout results preserve it; missing credentials produce no extra request. Label all timings from mocks as synthetic. A real key and real region-specific measurements are prerequisites for a performance claim or production adoption.

User scope override: no tests are being written or run for this POC. The replay and benchmark criteria above are future evidence requirements, not completed validation. Production delivery is authorized; API activation still needs a key.

## Two bounded implementation owners

1. Adapter owner: a new server-only Jev adapter. Own request/response validation, allowlisted state, credential handling, 300 ms abort budget, no retries, and typed `accepted | deferred` result. No conductor, UI, or reset-shell edits.
2. Integration owner: `src/lib/fairy-intent/router.ts` and a telemetry helper. Preserve deterministic caller bypasses and original fallback; construct and validate the canvas route, prove Cerebras is skipped only for accepted answers, and add comparable timing/outcome evidence. Coordinate the adapter contract before editing. Both owners preserve concurrent edits.

## Explicitly deferred

- Reset-shell integration until a real expensive bounded decision is identified there. Deterministic routing is already cheaper than a hosted classifier.
- Full multi-route replacement, bundle planning, argument extraction, and arbitrary component composition.
- New UI component frameworks or a `json-render` migration. Chris Tate's demo establishes a public claim of fast rendering with Jev; replies about its internals do not establish implementation evidence for PRESENT.
- Post-render Jev guards, continuous transcript scoring, speculative parallel calls to both providers, and additional network hops on the voice enqueue path.
- Credential acquisition, live latency claims without measurements, vendor speedup claims applied to PRESENT, or confidence treated as authorization for external/destructive actions.

Official interface evidence: [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart), [primitives](https://docs.typesafe.ai/primitives), [confidence guide](https://docs.typesafe.ai/confidence), and [launch claims with caveats](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
