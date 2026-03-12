import type { CanvasConfigOverrides } from '@/lib/agents/canvas-agent/server/config';
import type { FairyContextProfile } from '@/lib/fairy-context/profiles';

export type BenchmarkVariantPricing = {
  inputPer1MUsd?: number | null;
  outputPer1MUsd?: number | null;
  notes?: string;
  sourceUrl?: string;
};

export type BenchmarkVariant = {
  id: string;
  label: string;
  provider: 'anthropic' | 'openai' | 'cerebras';
  model: string;
  comparisonLabel: string;
  assumptions?: string[];
  pricing?: BenchmarkVariantPricing;
  execution: {
    preset: 'creative' | 'precise';
    contextProfile?: FairyContextProfile;
    configOverrides?: CanvasConfigOverrides;
  };
};

export type BenchmarkScenarioStep = {
  id: string;
  label: string;
  message: string;
};

export type BenchmarkScenario = {
  id: string;
  label: string;
  category: string;
  description: string;
  tags: string[];
  steps: BenchmarkScenarioStep[];
  evaluation: {
    minShapeCount: number;
    requiredVerbs?: string[];
    preferredVerbs?: string[];
  };
};

export type BenchmarkActionSummary = {
  total: number;
  byName: Record<string, number>;
};

export type BenchmarkShapeSummary = {
  total: number;
  byType: Record<string, number>;
};

export type BenchmarkTokenUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  cachedInputTokens?: number | null;
  totalTokens?: number | null;
};

export type BenchmarkCostEstimate = {
  inputUsd?: number | null;
  outputUsd?: number | null;
  totalUsd?: number | null;
  notes?: string | null;
  sourceUrl?: string | null;
};

export type BenchmarkVisualAnalysis = {
  summary: string;
  scoreRationale: string;
  strengths: string[];
  issues: string[];
};

export type BenchmarkRuntimeIdentity = {
  provider?: string | null;
  model?: string | null;
  phase?: 'initial' | 'followup' | null;
};

export type BenchmarkStepMetrics = {
  durationMs: number;
  ttfbMs?: number | null;
  actionCount?: number | null;
  mutatingActionCount?: number | null;
  followupCount?: number | null;
  retryCount?: number | null;
  firstAckMs?: number | null;
  screenshotRttMs?: number | null;
  screenshotResult?: string | null;
  usage?: BenchmarkTokenUsage | null;
  estimatedCostUsd?: number | null;
};

export type BenchmarkStepResult = {
  stepId: string;
  label: string;
  sessionId?: string | null;
  status: 'completed' | 'failed';
  actionSummary: BenchmarkActionSummary;
  metrics: BenchmarkStepMetrics;
  runtime?: BenchmarkRuntimeIdentity | null;
  metricEvents: Array<Record<string, unknown>>;
  error?: string;
};

export type BenchmarkScore = {
  overall: number;
  grade: 'excellent' | 'strong' | 'partial' | 'weak';
  rubric: {
    shapes: number;
    requiredVerbs: number;
    preferredVerbs: number;
    screenshot: number;
    stability: number;
  };
  notes: string[];
};

export type BenchmarkRun = {
  runId: string;
  scenarioId: string;
  variantId: string;
  scenarioLabel: string;
  variantLabel: string;
  comparisonLabel: string;
  category: string;
  startedAt: string;
  completedAt?: string;
  status: 'completed' | 'failed';
  requestedProvider?: string;
  requestedModel?: string;
  resolvedProvider?: string;
  resolvedModel?: string;
  provider?: string;
  model?: string;
  roomId: string;
  canvasId: string;
  canvasName: string;
  viewerPath: string;
  screenshotPath?: string;
  artifactPath: string;
  docPath: string;
  finalShapeCount: number;
  actionSummary: BenchmarkActionSummary;
  shapeSummary?: BenchmarkShapeSummary | null;
  metrics: {
    totalDurationMs: number;
    initialTtfbMs?: number | null;
    totalActionCount: number;
    totalMutatingActionCount: number;
    totalFollowupCount: number;
    totalRetryCount: number;
    avgFirstAckMs?: number | null;
    avgScreenshotRttMs?: number | null;
  };
  usage?: BenchmarkTokenUsage | null;
  estimatedCost?: BenchmarkCostEstimate | null;
  visualAnalysis?: BenchmarkVisualAnalysis | null;
  steps: BenchmarkStepResult[];
  score: BenchmarkScore;
  error?: string;
};

export type BenchmarkSuiteLifecycle = {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string | null;
  lastUpdatedAt: string;
  expectedRuns: number;
  writtenRuns: number;
  promoteLatest: boolean;
  latestPromotedAt?: string | null;
  failureMessage?: string | null;
};

export type BenchmarkManifest = {
  benchmark: 'canvas-agent-benchmark-suite';
  suiteId: string;
  generatedAt: string;
  baseUrl: string;
  executionMode: 'livekit-viewer-direct-runner';
  lifecycle: BenchmarkSuiteLifecycle;
  assumptions: string[];
  variants: BenchmarkVariant[];
  scenarios: BenchmarkScenario[];
  runs: BenchmarkRun[];
  summary: {
    totalRuns: number;
    completedRuns: number;
    successRatePct: number;
    byVariant: Array<{
      variantId: string;
      label: string;
      avgScore: number;
      avgDurationMs: number;
      avgTtfbMs: number | null;
      successRatePct: number;
    }>;
  };
  paths: {
    rootDir: string;
    assetDir: string;
    latestJson: string;
    latestHtml: string;
  };
};
