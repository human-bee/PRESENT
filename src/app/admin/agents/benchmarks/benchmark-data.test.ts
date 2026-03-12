/**
 * @jest-environment node
 */

const readFileMock = jest.fn();

jest.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

describe('loadBenchmarkManifest', () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it('prefers resolved runtime ids and exposes operator links', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        suiteId: 'suite-1',
        generatedAt: '2026-03-11T20:00:00.000Z',
        variants: [
          {
            id: 'gpt5-4-low',
            label: 'GPT-5.4 Low',
            provider: 'openai',
            model: 'openai:gpt-5.4',
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
            runId: 'run-1',
            scenarioId: 'business-operating-plan',
            variantId: 'gpt5-4-low',
            status: 'failed',
            requestedProvider: 'openai',
            requestedModel: 'openai:gpt-5.4',
            resolvedProvider: 'openai',
            resolvedModel: 'gpt-5.4',
            viewerPath: '/canvas?room=bench-room',
            screenshotPath: 'docs/benchmarks/canvas-agent/assets/foo.png',
            artifactPath: 'docs/benchmarks/canvas-agent/assets/foo.json',
            docPath: 'docs/benchmarks/canvas-agent/assets/foo-doc.json',
            metrics: {
              totalDurationMs: 1000,
              initialTtfbMs: 250,
              totalActionCount: 4,
              totalRetryCount: 2,
              totalFollowupCount: 1,
            },
            actionSummary: {
              total: 4,
              byName: { create_shape: 3, align: 1 },
            },
            shapeSummary: {
              total: 3,
              byType: { note: 2, text: 1 },
            },
            visualAnalysis: {
              summary: 'Readable but incomplete.',
              scoreRationale: 'Failure happened after the initial structure landed.',
              strengths: [],
              issues: [],
            },
            score: {
              overall: 71,
              notes: ['Missing final section.'],
            },
            error: 'structured output invalid',
          },
        ],
      }),
    );

    const { loadBenchmarkManifest } = await import('./benchmark-data');
    const manifest = await loadBenchmarkManifest();

    expect(manifest?.runs[0]).toMatchObject({
      requestedModel: 'openai:gpt-5.4',
      resolvedModel: 'gpt-5.4',
      viewerHref: '/canvas?room=bench-room',
      screenshotHref: '/admin/agents/benchmarks/asset/assets/foo.png',
      artifactHref: '/admin/agents/benchmarks/asset/assets/foo.json',
      docHref: '/admin/agents/benchmarks/asset/assets/foo-doc.json',
      error: 'structured output invalid',
    });
  });

  it('throws a helpful error when the manifest is invalid JSON', async () => {
    readFileMock.mockResolvedValue('{not-json');

    const { loadBenchmarkManifest } = await import('./benchmark-data');

    await expect(loadBenchmarkManifest()).rejects.toThrow('Benchmark manifest is not valid JSON');
  });
});
