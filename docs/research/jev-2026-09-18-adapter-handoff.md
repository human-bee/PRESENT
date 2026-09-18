# Jev adapter handoff

Date: 2026-09-18. Scope: server-only Fairy intent route decision adapter.

## Integration API

Import `tryJevCanvasRoute` and `JevRouteAttempt` from `src/lib/fairy-intent/jev-router.ts`.

```ts
export async function tryJevCanvasRoute(intent: FairyIntent): Promise<JevRouteAttempt>

type JevRouteAttempt = {
  outcome: 'accepted' | 'deferred' | 'skipped';
  reason: string;
  durationMs: number;
  model: string;
  choice?: 'canvas' | 'defer';
  confidence?: number;
  probabilities?: Record<string, number>;
};
```

The function never throws. Only a schema-valid `canvas` answer with confidence at least `0.95` returns `accepted`. Valid `defer` and lower-confidence `canvas` answers return `deferred`. Missing credentials, the 300 ms deadline, HTTP/provider failures, invalid JSON, and invalid answer schemas return `skipped`. The integration constructs and validates the existing canvas route from the unchanged intent message only when `outcome === 'accepted'`; all other outcomes use the existing router once.

## Request and validation

The adapter makes at most one direct `POST https://api.typesafe.ai/v1/systemone` request with bearer authentication, `Content-Type: application/json`, and model `jev-latest`. Its body follows the official quick-start shape: `state`, `model`, and a `questions.route` Choice with `type`, `instructions`, and `criteria`.

The allowlisted state contains only the original message, source, selection/bounds/component counts, and context profile. It excludes metadata, transcripts, canvas documents, credentials, generated arguments, component props, actions, and user-facing prose. Messages over 16,000 characters are refused rather than truncated or sent.

The response must provide `answers.route` as a Choice answer. The choice must be `canvas` or `defer`; confidence and both probabilities must be finite values in `[0, 1]` and sum to one within `0.01`; no extra probability keys are accepted; and the selected choice cannot have a lower probability than the alternative. The request pins `jev-latest`, while response validation permits the provider to report a resolved model identifier instead of the request alias.

The 300 ms wall-clock deadline covers fetch, body reading, JSON parsing, and answer validation. The adapter aborts the request at the deadline, ignores late completion through the settled race, and never retries. If `TYPESAFE_API_KEY` is absent or blank, it returns before calling `fetch`.

No live TypeSafe call or performance claim was made. Per the task constraint, no tests or broad checks were added or run.
