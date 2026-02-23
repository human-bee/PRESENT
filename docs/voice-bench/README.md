# Voice Bench

`scripts/voice-bench` provides a lightweight replay/gating harness for noisy-room voice regression checks.

## Scripts

- Replay runner: `scripts/voice-bench/run-replay.ts`
- Scoring + markdown summary: `scripts/voice-bench/score-results.ts`

## Local Usage

```bash
npx tsx scripts/voice-bench/run-replay.ts \
  --variant=baseline \
  --input=docs/voice-bench/fixtures/two-speaker-noisy-sample.json \
  --out=artifacts/voice-bench/baseline.json

npx tsx scripts/voice-bench/run-replay.ts \
  --variant=candidate \
  --input=docs/voice-bench/fixtures/two-speaker-noisy-sample.json \
  --baseline=artifacts/voice-bench/baseline.json \
  --out=artifacts/voice-bench/candidate.json

npx tsx scripts/voice-bench/score-results.ts \
  --results=artifacts/voice-bench/candidate.json \
  --baseline=artifacts/voice-bench/baseline.json \
  --summary=artifacts/voice-bench/summary.md
```

CI (`.github/workflows/voice-bench.yml`) runs candidate-only replay without a same-run baseline so the gate is not self-referential.

## Current Gate Logic (Phase 1)

- Latency gate: candidate P95 final-transcript latency must be `<= max(900ms, baseline * 1.10)`.
- Stability gate: candidate error events must be `<= baseline`.
- CPU gate: candidate CPU P95 must be `<= baseline * 1.15` when both variants report CPU.
- When no baseline file is provided, fallback thresholds apply: latency target `900ms`, stability requires `0` error events, and CPU gate is pass-through.

The scripts exit non-zero if the composite gate fails.
