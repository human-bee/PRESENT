type MetricCounterKey =
  | 'capabilityQueries'
  | 'capabilityFallbacks'
  | 'mutationDeduped'
  | 'mutationExecuted'
  | 'verificationFailures';

type TimingEntry = {
  stage: string;
  durationMs: number;
  task?: string;
  route?: string;
};

type MetricsSnapshot = {
  counters: Record<MetricCounterKey, number>;
  recentTimings: TimingEntry[];
};

const metrics: MetricsSnapshot = {
  counters: {
    capabilityQueries: 0,
    capabilityFallbacks: 0,
    mutationDeduped: 0,
    mutationExecuted: 0,
    verificationFailures: 0,
  },
  recentTimings: [],
};

const TIMING_LIMIT = 200;

export const incrementOrchestrationCounter = (key: MetricCounterKey, value = 1) => {
  metrics.counters[key] += value;
};

export const recordOrchestrationTiming = (entry: TimingEntry) => {
  metrics.recentTimings.push(entry);
  if (metrics.recentTimings.length > TIMING_LIMIT) {
    metrics.recentTimings.splice(0, metrics.recentTimings.length - TIMING_LIMIT);
  }
};

export const getOrchestrationMetricsSnapshot = (): MetricsSnapshot => ({
  counters: { ...metrics.counters },
  recentTimings: metrics.recentTimings.slice(),
});

