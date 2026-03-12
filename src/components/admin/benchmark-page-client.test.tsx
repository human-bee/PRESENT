import { render, screen, waitFor } from '@testing-library/react';
import { BenchmarkPageClient } from './benchmark-page-client';

const fetchWithSupabaseAuthMock = jest.fn();
const mockJsonResponse = (body: unknown, status: number) => ({
  ok: status >= 200 && status < 300,
  status,
  clone: () => ({
    json: async () => body,
  }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

jest.mock('@/lib/supabase/auth-headers', () => ({
  fetchWithSupabaseAuth: (...args: unknown[]) => fetchWithSupabaseAuthMock(...args),
}));

describe('BenchmarkPageClient', () => {
  beforeEach(() => {
    fetchWithSupabaseAuthMock.mockReset();
  });

  it('renders an access message when benchmark admin auth fails', async () => {
    fetchWithSupabaseAuthMock.mockResolvedValue(mockJsonResponse({ error: 'unauthorized' }, 401));

    render(<BenchmarkPageClient />);

    expect(await screen.findByText('Benchmark access requires sign-in.')).toBeTruthy();
    expect(screen.getByText(/unauthorized/)).toBeTruthy();
  });

  it('renders the empty manifest state when no suite is available', async () => {
    fetchWithSupabaseAuthMock.mockResolvedValue(mockJsonResponse({ manifest: null }, 200));

    render(<BenchmarkPageClient />);

    expect(await screen.findByText('No benchmark manifest found yet.')).toBeTruthy();
  });

  it('renders the benchmark suite when manifest loading succeeds', async () => {
    fetchWithSupabaseAuthMock.mockResolvedValue(
      mockJsonResponse(
        {
          manifest: {
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
                artifactHref: null,
                docHref: null,
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
          },
        },
        200,
      ),
    );

    render(<BenchmarkPageClient />);

    expect(
      await screen.findByText('PRESENT fairy and canvas benchmarks, rendered as an operator surface.'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Business Operating Plan' })).toBeTruthy();
    });
  });
});
