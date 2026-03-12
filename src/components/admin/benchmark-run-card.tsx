import type {
  BenchmarkRunView,
  BenchmarkVariantView,
} from '@/app/admin/agents/benchmarks/benchmark-data';

const formatMetric = (value: number | null, unit = '') =>
  value === null ? 'n/a' : `${Math.round(value)}${unit}`;

const metricItems = (run: BenchmarkRunView) => [
  { label: 'TTFB', value: formatMetric(run.metrics.ttfbMs, ' ms') },
  { label: 'Total', value: formatMetric(run.metrics.totalMs, ' ms') },
  { label: 'Actions', value: formatMetric(run.metrics.actionCount) },
  { label: 'Tokens', value: formatMetric(run.metrics.totalTokens) },
  { label: 'Cost', value: run.metrics.costUsd === null ? 'n/a' : `$${run.metrics.costUsd.toFixed(4)}` },
  { label: 'Retries', value: formatMetric(run.metrics.retryCount) },
];

const topBreakdown = (breakdown: Record<string, number>) =>
  Object.entries(breakdown)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);

export function BenchmarkRunCard({
  run,
  variant,
}: {
  run: BenchmarkRunView | null;
  variant: BenchmarkVariantView;
}) {
  const status = run?.status ?? 'missing';
  const score = run?.score;

  return (
    <article className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b121d] shadow-[0_24px_60px_rgba(0,0,0,0.3)]">
      <div className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: variant.accent }} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-[#baa894]">
              {variant.provider ?? 'provider'}
            </p>
            <h3
              className="mt-2 text-2xl text-[#fff7ed]"
              style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
            >
              {variant.label}
            </h3>
            <p className="mt-2 text-sm text-[#d6c6b2]">
              {run?.resolvedModel ?? variant.model ?? 'Model id unavailable'}
            </p>
            {run?.requestedModel && run.requestedModel !== run.resolvedModel ? (
              <p className="mt-1 text-xs text-[#bcae9c]">Requested {run.requestedModel}</p>
            ) : null}
          </div>
          <div className="text-right">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.25em] text-[#efe2d2]">
              {status}
            </span>
            <p className="mt-3 text-xs uppercase tracking-[0.28em] text-[#baa894]">Score</p>
            <p className="mt-1 text-2xl text-[#f8fafc]">
              {score === null ? 'n/a' : score.toFixed(1)}
            </p>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#111927]">
          {run?.screenshotHref ? (
            <img
              src={run.screenshotHref}
              alt={run.screenshotLabel ?? `${variant.label} result`}
              className="h-[260px] w-full object-cover transition duration-500 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-[260px] items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(249,115,22,0.2),_transparent_40%),linear-gradient(180deg,_rgba(17,25,39,0.96),_rgba(9,13,20,1))] px-8 text-center text-sm leading-7 text-[#c7b9a6]">
              No screenshot artifact was available for this attempt.
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          {metricItems(
            run ?? {
              id: '',
              scenarioId: '',
              variantId: '',
              comparisonLabel: null,
              status: 'missing',
              score: null,
              screenshotHref: null,
              screenshotLabel: null,
              metrics: {
                ttfbMs: null,
                totalMs: null,
                actionCount: null,
                retryCount: null,
                followupCount: null,
                errorCount: null,
                totalTokens: null,
                inputTokens: null,
                outputTokens: null,
                costUsd: null,
              },
              actionSummary: { total: null, byName: {} },
              shapeSummary: { total: null, byName: {} },
              visualAnalysis: { summary: null, scoreRationale: null, strengths: [], issues: [] },
              notes: [],
              error: null,
              requestedProvider: null,
              requestedModel: null,
              resolvedProvider: null,
              resolvedModel: null,
              viewerHref: null,
              artifactHref: null,
              docHref: null,
              rawMetrics: null,
            },
          ).map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3"
            >
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#bba894]">
                {metric.label}
              </p>
              <p className="mt-2 text-lg text-[#fff7ed]">{metric.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-[#cdbda9]">
          {variant.priceLabel ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
              {variant.priceLabel}
            </span>
          ) : null}
          {run?.resolvedProvider ? (
            <span className="rounded-full border border-white/10 px-3 py-1">
              Runtime {run.resolvedProvider}
            </span>
          ) : null}
          {run?.notes?.slice(0, 2).map((note) => (
            <span key={note} className="rounded-full border border-white/10 px-3 py-1">
              {note}
            </span>
          ))}
        </div>

        {run ? (
          <div className="mt-5 space-y-4 rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4 text-sm text-[#e8dbc9]">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-[#bba894]">Visual Read</p>
              <p className="mt-2 leading-6 text-[#fff7ed]">
                {run.visualAnalysis.summary ?? 'No screenshot analysis generated yet.'}
              </p>
              {run.visualAnalysis.scoreRationale ? (
                <p className="mt-2 text-xs leading-5 text-[#d6c6b2]">
                  {run.visualAnalysis.scoreRationale}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#bba894]">Action Mix</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {topBreakdown(run.actionSummary.byName).map(([name, count]) => (
                    <span
                      key={`action-${name}`}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#f7e7d4]"
                    >
                      {name} {count}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#bba894]">Final Shape Mix</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {topBreakdown(run.shapeSummary.byName).map(([name, count]) => (
                    <span
                      key={`shape-${name}`}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#f7e7d4]"
                    >
                      {name} {count}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {(run.viewerHref || run.artifactHref || run.docHref) ? (
              <div>
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#bba894]">Evidence</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {run.viewerHref ? (
                    <a
                      href={run.viewerHref}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#f7e7d4]"
                    >
                      Viewer
                    </a>
                  ) : null}
                  {run.artifactHref ? (
                    <a
                      href={run.artifactHref}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#f7e7d4]"
                    >
                      Run JSON
                    </a>
                  ) : null}
                  {run.docHref ? (
                    <a
                      href={run.docHref}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#f7e7d4]"
                    >
                      Shape Doc
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
