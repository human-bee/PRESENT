'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BenchmarkRunView,
  BenchmarkVariantView,
} from '@/app/admin/agents/benchmarks/benchmark-data';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';

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

const deriveAssetFilename = (href: string | null, fallback: string) => {
  if (!href) return fallback;
  const raw = href.split('/').pop();
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export function BenchmarkRunCard({
  run,
  variant,
}: {
  run: BenchmarkRunView | null;
  variant: BenchmarkVariantView;
}) {
  const status = run?.status ?? 'missing';
  const score = run?.score ?? null;
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotStatus, setScreenshotStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  );
  const [assetError, setAssetError] = useState<string | null>(null);
  const [shouldLoadScreenshot, setShouldLoadScreenshot] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const screenshotFilename = useMemo(
    () => deriveAssetFilename(run?.screenshotHref ?? null, `${variant.id}-screenshot.png`),
    [run?.screenshotHref, variant.id],
  );

  useEffect(() => {
    if (!run?.screenshotHref) {
      setShouldLoadScreenshot(false);
      return () => {};
    }
    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoadScreenshot(true);
      return () => {};
    }

    const node = articleRef.current;
    if (!node) {
      setShouldLoadScreenshot(true);
      return () => {};
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadScreenshot(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [run?.screenshotHref]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const screenshotHref = run?.screenshotHref ?? null;

    if (!screenshotHref) {
      setScreenshotStatus('idle');
      setScreenshotUrl(null);
      setAssetError(null);
      return () => {};
    }
    if (!shouldLoadScreenshot) {
      setScreenshotStatus('idle');
      setScreenshotUrl(null);
      return () => {};
    }

    const loadScreenshot = async () => {
      try {
        setAssetError(null);
        setScreenshotStatus('loading');
        const response = await fetchWithSupabaseAuth(screenshotHref, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Screenshot request failed (${response.status})`);
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setScreenshotUrl(objectUrl);
        setScreenshotStatus('ready');
      } catch (error) {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        if (active) {
          setScreenshotUrl(null);
          setScreenshotStatus('error');
          setAssetError(error instanceof Error ? error.message : 'Unable to load screenshot artifact.');
        }
      }
    };

    void loadScreenshot();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [run?.screenshotHref, shouldLoadScreenshot]);

  const openAuthorizedAsset = async (href: string | null, filename: string) => {
    if (!href) return;
    try {
      setAssetError(null);
      const response = await fetchWithSupabaseAuth(href, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Artifact request failed (${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setAssetError(error instanceof Error ? error.message : 'Unable to open benchmark artifact.');
    }
  };

  return (
    <article
      ref={articleRef}
      className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b121d] shadow-[0_24px_60px_rgba(0,0,0,0.3)]"
    >
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
          {screenshotUrl ? (
            <img
              src={screenshotUrl}
              alt={run?.screenshotLabel ?? `${variant.label} result`}
              className="h-[260px] w-full object-cover transition duration-500 group-hover:scale-[1.02]"
            />
          ) : run?.screenshotHref && screenshotStatus === 'loading' ? (
            <div className="flex h-[260px] items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(20,184,166,0.18),_transparent_42%),linear-gradient(180deg,_rgba(17,25,39,0.96),_rgba(9,13,20,1))] px-8 text-center text-sm leading-7 text-[#c7b9a6]">
              Loading authenticated screenshot artifact…
            </div>
          ) : run?.screenshotHref && !shouldLoadScreenshot ? (
            <div className="flex h-[260px] items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.12),_transparent_42%),linear-gradient(180deg,_rgba(17,25,39,0.96),_rgba(9,13,20,1))] px-8 text-center text-sm leading-7 text-[#c7b9a6]">
              Screenshot will load when this card scrolls into view.
            </div>
          ) : (
            <div className="flex h-[260px] items-center justify-center bg-[radial-gradient(circle_at_center,_rgba(249,115,22,0.2),_transparent_40%),linear-gradient(180deg,_rgba(17,25,39,0.96),_rgba(9,13,20,1))] px-8 text-center text-sm leading-7 text-[#c7b9a6]">
              {run?.screenshotHref && screenshotStatus === 'error'
                ? assetError ?? 'Unable to load screenshot artifact.'
                : 'No screenshot artifact was available for this attempt.'}
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

            {(run.viewerHref || run.artifactHref || run.docHref || run.screenshotHref) ? (
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
                    <button
                      type="button"
                      onClick={() =>
                        void openAuthorizedAsset(
                          run.artifactHref,
                          deriveAssetFilename(run.artifactHref, `${variant.id}-run.json`),
                        )
                      }
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#f7e7d4]"
                    >
                      Run JSON
                    </button>
                  ) : null}
                  {run.docHref ? (
                    <button
                      type="button"
                      onClick={() =>
                        void openAuthorizedAsset(
                          run.docHref,
                          deriveAssetFilename(run.docHref, `${variant.id}-shape-doc.json`),
                        )
                      }
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#f7e7d4]"
                    >
                      Shape Doc
                    </button>
                  ) : null}
                  {run.screenshotHref ? (
                    <button
                      type="button"
                      onClick={() => void openAuthorizedAsset(run.screenshotHref, screenshotFilename)}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#f7e7d4]"
                    >
                      Screenshot
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {assetError ? (
              <p className="text-xs leading-5 text-[#fca5a5]">{assetError}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
