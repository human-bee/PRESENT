# Jev POC source review

Reviewed 2026-09-18. Source inspection only: no tests, builds, typechecks, provider calls, or runtime execution. No performance or live correctness claim follows from this review.

## Result

No blocking issue found in the current adapter and route integration after removal of the `server-only` package import. The review identified a telemetry resilience gap: synchronous telemetry exceptions could prevent the original fallback or accepted return. The integration owner added a best-effort catch inside `recordJevRouterAttempt`; source readback confirms the fix. The root agent also requested a constant unexpected-error reason instead of copying an exception name.

## Inspected invariants

- The production conductor command uses standalone `tsx --tsconfig tsconfig.agent.json`. The adapter now uses a comment to mark its server scope and no runtime `server-only` import. Import references inspected remain on the server Fairy/conductor route.
- Jev runs after the original fast-steward availability return. Accepted results are schema checked and return before the Cerebras call. Deferred, malformed, missing-key, HTTP-error, and timeout results continue to the original route. No new dispatch operation is introduced.
- The 300 ms race includes fetch and body parsing, aborts the request, has no retry, and checks elapsed time after synchronous validation. As with any JavaScript timer, this is a decision budget, not a hard wall-clock execution guarantee under event-loop stalls.
- Probability values are finite and bounded, both expected options are required, their sum must be within 0.01 of one, and the selected option cannot be below the alternate option. The provisional confidence threshold remains 0.95. The parser permits resolved model aliases because it does not require response.model to equal jev-latest.
- The outgoing state contains message plus a short allowlist. Telemetry records correlation IDs, decision metadata, and duration; it does not include the API key, authorization header, message, or raw provider response. The environment example has an empty server credential.
- The production-copy replay input type accepts the helper's provider, status, latency, and metadata fields. `docs/migrations/012_agent_replay_full_telemetry.sql` uses text provider/status and JSONB metadata, so this helper requires no schema migration. This is source compatibility, not confirmation of a deployed database migration.
- The decision note accurately limits the POC and leaves benchmark/replay evidence pending. The existing unrelated conductor diff should not be included in a task-only release.

## API evidence

Live readback of the official [TypeSafe quick start](https://docs.typesafe.ai/introduction/quickstart) confirms the endpoint, bearer authentication, model alias, named choice question with criteria, and answer choice/probabilities/confidence fields used here. The supplied state may be structured according to the existing primary research. No credential was used and no inference request was sent.

## Remaining limits

The response length check happens after `response.text()` has buffered the response; it bounds JSON parsing size rather than download memory. This is a low-priority hardening opportunity for the fixed trusted provider. A real key, labeled traffic, and deployed runtime readback remain necessary before claiming routing accuracy or latency improvement.
