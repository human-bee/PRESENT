import { fireEvent, render, screen } from '@testing-library/react';
import { BenchmarkExplorer } from './benchmark-explorer';
import type { BenchmarkManifestView } from '@/app/admin/agents/benchmarks/benchmark-data';

const manifest: BenchmarkManifestView = {
  suiteId: 'suite-1',
  generatedAt: '2026-03-11T20:00:00.000Z',
  sourcePath: '/tmp/latest.json',
  summary: {
    totalRuns: 1,
    completedRuns: 1,
    passRate: 1,
    averageScore: 91,
    fastestTtfbMs: 250,
  },
  variants: [
    {
      id: 'haiku-4-5',
      label: 'Claude Haiku 4.5',
      provider: 'anthropic',
      model: 'anthropic:claude-haiku-4-5',
      priceLabel: null,
      accent: '#f97316',
    },
  ],
  scenarios: [
    {
      id: 'business-operating-plan',
      label: 'Business Operating Plan',
      category: 'business',
      description: 'Board',
    },
  ],
  runs: [
    {
      id: 'run-1',
      scenarioId: 'business-operating-plan',
      variantId: 'haiku-4-5',
      comparisonLabel: 'haiku-4.5',
      status: 'completed',
      score: 91,
      requestedProvider: 'anthropic',
      requestedModel: 'anthropic:claude-haiku-4-5',
      resolvedProvider: 'anthropic',
      resolvedModel: 'claude-haiku-4-5',
      screenshotHref: null,
      screenshotLabel: null,
      viewerHref: '/canvas?room=bench-room',
      artifactHref: '/admin/agents/benchmarks/asset/benchmarks/canvas-agent/assets/foo.json',
      docHref: '/admin/agents/benchmarks/asset/benchmarks/canvas-agent/assets/foo-doc.json',
      metrics: {
        ttfbMs: 250,
        totalMs: 1000,
        actionCount: 4,
        retryCount: 1,
        followupCount: 0,
        errorCount: 0,
        totalTokens: 1234,
        inputTokens: 1000,
        outputTokens: 234,
        costUsd: 0.0042,
      },
      actionSummary: {
        total: 4,
        byName: { create_shape: 3, align: 1 },
      },
      shapeSummary: {
        total: 3,
        byName: { note: 2, text: 1 },
      },
      visualAnalysis: {
        summary: 'Readable board.',
        scoreRationale: 'Strong hierarchy.',
        strengths: [],
        issues: [],
      },
      notes: ['Strong balance.'],
      error: null,
      rawMetrics: null,
    },
  ],
};

describe('BenchmarkExplorer', () => {
  it('shows an explicit empty state when filters remove every run', () => {
    render(<BenchmarkExplorer manifest={manifest} />);

    const search = screen.getByPlaceholderText('multi-fairy, failed, hero, sketch...');
    fireEvent.change(search, { target: { value: 'no-match-query' } });

    expect(
      screen.getByText(
        'No runs matched the current filters. Clear one or more filters to bring the suite back into view.',
      ),
    ).toBeTruthy();
  });
});
