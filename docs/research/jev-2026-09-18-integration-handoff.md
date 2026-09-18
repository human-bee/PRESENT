# Jev Fairy router integration handoff

Date: 2026-09-18

## Scope

The narrow Jev gate runs inside `routeFairyIntent` after the existing fast-steward readiness fallback and before the Cerebras client is created. Existing deterministic conductor routes remain upstream and unchanged.

Only an adapter result with `outcome: accepted` is converted into a route. The route is validated with `FairyRouteDecisionSchema`, uses the original intent message byte-for-byte, preserves `contextProfile` when present, and returns immediately without calling Cerebras. Deferred, skipped, unexpected, or locally invalid accepted results continue through the original Cerebras route exactly once.

## Files

- `src/lib/fairy-intent/router.ts`: calls the adapter at the bounded route seam and validates the accepted canvas route.
- `src/lib/fairy-intent/jev-router-telemetry.ts`: records provider, model, duration, outcome, reason, choice, confidence, probabilities, and existing correlation IDs. It does not record the Jev prompt or state payload.
- `example.env.local`: documents the optional server-only `TYPESAFE_API_KEY`.
- `src/lib/fairy-intent/jev-router.ts`: adapter owned by the paired adapter implementation.

## Limitations

- This affects the Fairy intent path in the native realtime/conductor runtime. It does not add a Jev decision to the reset shell or browser.
- Missing credentials, the 300 ms adapter deadline, provider errors, invalid responses, `defer`, and low confidence all retain the existing Cerebras behavior, with up to the adapter decision budget added before fallback.
- Replay telemetry is best effort and cannot interrupt either an accepted route or the existing fallback path.
- The integration has no feature flag and does not expose the TypeSafe key to client code.
- No live TypeSafe request, latency claim, deployment, schema migration, conductor change, or browser change is included.
- Per the implementation request, no additional tests were written or run for this integration patch.
