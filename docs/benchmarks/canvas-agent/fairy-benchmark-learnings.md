# Fairy Canvas Benchmark Learnings

## Purpose

- Create a repeatable side-by-side benchmark for the PRESENT fairy/TLDraw stack across business, collaboration, play, presentation, scratchpad, and freeform drawing scenarios.
- Compare models on output quality, latency, retry churn, action mix, and failure texture using the same viewer path, screenshot capture flow, and scoring rubric.
- Produce operator-grade artifacts: manifest JSON, HTML report, admin surface, screenshots, and scenario-level evidence for future tuning.

## What We Learned About The Fairy Setup

- The benchmark is most reliable when the fairy runs through the server steward plus a live parity viewer. Direct browser-only assumptions were the main source of false negatives.
- Viewer connectivity matters as much as model quality. If the benchmark page loads but never presses `Connect`, screenshot RPCs time out and the run looks broken even when the steward is fine.
- For local benchmarking, live viewer truth is more reliable than persisted canvas state. The browser can successfully render and execute actions while local persistence still fails under session/RLS constraints.
- The current system rewards models that emit valid TLDraw-native actions immediately. Extra reasoning depth does not help if it delays first action envelopes past realtime tolerances.
- Multi-zone and presentation layouts stress different behavior than sticky-note boards. The benchmark needs both structured business boards and freer drawing scenarios because model rankings change by scenario type.
- The fairy quick-picker only works if it writes into the same server-first contract the queue path reads. Anything scoped to the retired client fairy state is operationally fake.
- Admin benchmark surfaces have to follow the browser bearer-token model the rest of PRESENT uses. SSR-only auth checks look correct in code review, but they fail in practice against localStorage-backed Supabase sessions.
- Room-wide `agent_prompt` broadcasts are an observability surface, not a private runtime channel. They must carry enough context for the viewer, but never BYOK identity or key-source metadata.

## Concrete Bugs Found

- Worktree env drift: missing local provider keys caused Anthropic and Cerebras selection failures until the harness backfilled from the canonical checkout `.env.local`.
- Viewer boot bug: the benchmark loaded `/canvas?...&parity=1` but did not reliably connect the viewer, which caused screenshot request timeouts.
- Metrics ingestion bug: the admin page normalized the wrong metric keys and rendered `n/a` for totals, actions, retries, and followups even though the manifest had the data.
- Persisted-shape truth bug: local `canvas_sessions` writes failed, so persisted shape counts underreported benchmark output and would have mis-scored runs.
- Structured-output instability: Cerebras completed most scenarios quickly, but one run still failed on invalid JSON.
- Local infra noise: replay telemetry inserts and `canvas_agent_todos.session_id` schema-cache warnings were noisy and made logs look worse than the actual benchmark outcome.
- Fairy model contract drift: the supported server-first canvas runtime and the retired vendor fairy model registry had diverged, so a quick picker could have looked real while doing nothing on the actual queue-backed path.
- Queue propagation gap: `runCanvas` accepted request-level model overrides, but the `fairy.intent -> canvas.agent_prompt` handoff rebuilt a smaller payload and dropped model/provider plus BYOK runtime context before the steward executed.
- Provider misclassification: bare `gpt-oss-120b` strings were inferred as Cerebras at ingress but matched the OpenAI branch in the runner because generic `gpt*` detection ran before `gpt-oss*`.
- Benchmark admin auth gap: the operator page and asset route originally served local benchmark files without the same admin access checks used elsewhere in the agent admin surface.
- Sticky picker outage: once a user chose an unavailable benchmark lane, that localStorage value could poison later fairy prompts until the browser state was cleared manually.
- Benchmark asset fetch gap: screenshot and JSON links worked as plain URLs in theory, but they bypassed Supabase bearer auth and silently broke in the actual browser session model.

## Fixes Already Made

- Added a dedicated benchmark harness and catalog with 10 scenarios plus model/variant metadata.
- Added Cerebras model support and model alias wiring so the suite can compare Anthropic, OpenAI, and Cerebras in one path.
- Hardened env loading so worktrees inherit missing local secrets from the canonical checkout without printing secret values.
- Added viewer-shell detection and explicit connect handling before running steward actions.
- Changed final scoring to use live viewer canvas state when persisted state is missing or stale.
- Added an admin benchmark surface and static HTML report, then fixed the admin normalization bug so run metrics render correctly.
- Moved benchmark manifest loading behind an authenticated admin API route and switched the page to client-authenticated fetching so the surface works with the same auth contract as the rest of agent admin.
- Restricted benchmark asset serving to `docs/benchmarks/canvas-agent/**`, hardened the traversal guard, and changed screenshot or artifact rendering to use auth-backed blob fetches instead of raw asset URLs.
- Added sticky model reset handling so unavailable quick-picker lanes fall back to Auto instead of repeatedly bricking fairy prompts.

## Model Takeaways

### Claude Haiku 4.5

- Best current balance for realtime use.
- Quality is consistently strong without catastrophic failures in this suite.
- Latency is still far above the target realtime SLO, but materially closer than GPT-5 Low.
- Good default when reliability matters more than absolute polish.

### GPT-5.4 Low

- Highest average quality in the suite.
- Too slow for low-latency live canvas work in its current configuration.
- Best fit for offline generation, higher-fidelity review boards, or slower background drafting modes.

### Cerebras GPT OSS 120B

- Fastest by a wide margin and clearly promising for realtime.
- Quality ceiling is good on layout-driven tasks, but floor is less stable.
- Structured-output reliability is the blocking issue; once that is tightened, it becomes the strongest latency candidate.

## Optimization Takeaways

- Default recommendation now: Haiku for live fairy sessions, GPT-5.4 Low for offline/high-fidelity runs, Cerebras as the experimental low-latency lane.
- The next big gain is not raw prompting volume; it is stricter structured-output reliability and better low-latency action emission.
- For realtime modes, prioritize lower TTFB, fewer retries, and stable action validity over marginal score gains.
- Scenario design matters: one benchmark catalog should include structured boards, collaborative zones, and freehand pressure tests, because no single model won every category.
- A model picker has to be backed by the server-first contract, not the retired fairy client state. Otherwise it becomes a UI placebo.
- The benchmark report needs both requested and resolved runtime model ids. Labels such as `gpt5.4-low` are useful for comparisons, but the operator surface still has to reveal the actual runtime model that executed.
- Benchmark UI polish is only worth trusting if the auth path is real. A beautiful operator surface that cannot load screenshots or JSON under normal admin auth is worse than a raw report because it hides the actual failure mode.

## Recommended Next Experiments

- Add token and cost accounting per run so quality can be compared against spend, not just latency.
- Add filterable table views and richer action/shape breakdowns so operators can compare runs without scrolling screenshot cards.
- Add screenshot-level visual analysis so each run has a short machine-generated explanation of why it scored well or poorly.
- Expand the freehand catalog with more pen-heavy and sketch-heavy scenarios.
- Separate final-shape mix from action-verb mix in the report so “what it did” and “what it produced” are both visible.
- Run the same suite with context-window inflation, tool-bloat variants, and followup-depth variants to identify the cheapest acceptable config per use case.
- Add a queue-first benchmark mode that sends real `fairy.intent` work into shared rooms. The current harness is great for viewer-observed canvas quality, but it still bypasses the full contention/coalescing path that live fairy traffic sees.
- Track first-ack coverage as a first-class health metric. Several slow or failed runs were more about viewer ack starvation than model reasoning quality.

## Operational Caveats

- Current local benchmarks are valid for viewer-observed output, but not all local persistence paths are healthy.
- Replay telemetry failures are noisy but were not benchmark blockers in this run.
- Any claim about “best model” needs to be scoped by use case: realtime collaboration, business boards, freehand drawing, and presentation polish each favor different tradeoffs.
- The benchmark report should show both the comparison label and the actual runtime model id to avoid confusion around lean benchmark labels such as `gpt5.4-low`.
- The March 11 GPT-5.4 rerun work exposed two local infra failure modes that can invalidate long suites: `next dev` dropping `127.0.0.1:3000` and non-persistent LiveKit sessions dropping `127.0.0.1:7880`.
- The harness now retries viewer boot and records per-run failures instead of aborting the whole suite, but interim reruns produced while the harness still had the `status is not defined` bug should be treated as invalid.
- The aborted `canvas-benchmark-full-gpt54-rerun-2026-03-11` attempt left JSON/PNG evidence under `docs/benchmarks/canvas-agent/assets/canvas-benchmark-full-gpt54-rerun-2026-03-11/`, but never wrote the timestamped top-level suite manifest/report. That proved end-of-suite-only manifest flushing is not enough for long reruns.
- During that same rerun, `docs/benchmarks/canvas-agent/latest.json` stayed pinned to the older `canvas-benchmark-full-2026-03-11` suite. That is the right default for explicit promotion semantics, but it also means the timestamped suite artifact has to be live-updated if operators need in-progress visibility.
- The current benchmark is a better proxy for canvas-model output quality than full live fairy operability. It does not yet stress same-room contention, multi-viewer authority drift, or queue-level overlap the way production fairy sessions do.
