# Voice Agent Racetrack Benchmark

This benchmark tracks runtime hotspots for the voice-agent pipeline and records results per commit.

## Command

```bash
npm run bench:racetrack
```

## What it tracks

- Capability manifest build cost (`full` vs `lean_adaptive`)
- Instruction build cost and prompt-size reduction
- Mutation arbiter behavior:
  - serialized single-lock throughput
  - parallel multi-lock throughput
  - idempotency dedupe correctness

## Artifacts

- Latest run: `docs/benchmarks/racetrack/latest.json`
- Time series: `docs/benchmarks/racetrack/history.jsonl`

Run this before each commit that affects voice-agent runtime to maintain the racetrack history.
