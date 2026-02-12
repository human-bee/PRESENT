# Voice Agent Racetrack Benchmark

This benchmark tracks runtime hotspots in the voice-agent orchestration path and records results per commit.

## Command

```bash
npm run bench:racetrack
```

## What it tracks

- Voice instruction-build throughput
- Component patch normalization throughput
- Canvas dispatch suppression throughput and suppress-rate
- Component ledger operation throughput
- Pending tool-call queue flush throughput

## Artifacts

- Latest run: `docs/benchmarks/racetrack/latest.json`
- Time series: `docs/benchmarks/racetrack/history.jsonl`

Run this before and after major orchestration changes so performance regressions are visible in history.
