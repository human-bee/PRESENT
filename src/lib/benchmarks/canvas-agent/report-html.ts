import type { BenchmarkManifest } from './types';

const esc = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const fmtMs = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
};

const fmtUsd = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `$${value.toFixed(4)}`;
};

const toAssetHref = (rootDir: string, maybePath?: string) => {
  if (!maybePath) return '';
  const normalizedRoot = rootDir.replace(/\/+$/, '');
  if (maybePath.startsWith(`${normalizedRoot}/`)) {
    return maybePath.slice(normalizedRoot.length + 1);
  }
  return maybePath;
};

export function renderBenchmarkHtml(manifest: BenchmarkManifest) {
  const lifecycle = manifest.lifecycle ?? {
    status: 'completed',
    startedAt: manifest.generatedAt,
    completedAt: manifest.generatedAt,
    lastUpdatedAt: manifest.generatedAt,
    expectedRuns: manifest.summary.totalRuns,
    writtenRuns: manifest.runs.length,
    promoteLatest: false,
    latestPromotedAt: null,
    failureMessage: null,
  };
  const variantById = new Map(manifest.variants.map((variant) => [variant.id, variant]));
  const failedWrittenRuns = Math.max(lifecycle.writtenRuns - manifest.summary.completedRuns, 0);
  const lifecycleLabel =
    lifecycle.status === 'running'
      ? 'Partial Snapshot'
      : lifecycle.status === 'failed'
        ? 'Failed Snapshot'
        : 'Final Snapshot';
  const lifecycleMessage =
    lifecycle.status === 'running'
      ? `${lifecycle.writtenRuns}/${lifecycle.expectedRuns} runs written so far (${manifest.summary.completedRuns} completed${failedWrittenRuns > 0 ? `, ${failedWrittenRuns} failed` : ''}). This timestamped suite artifact keeps updating while the run is still in flight.`
      : lifecycle.status === 'failed'
        ? `${lifecycle.writtenRuns}/${lifecycle.expectedRuns} runs were written before the suite exited.${lifecycle.failureMessage ? ` Terminal error: ${lifecycle.failureMessage}` : ''}`
        : `${manifest.summary.completedRuns}/${lifecycle.expectedRuns} runs completed.${lifecycle.promoteLatest ? ' Latest promotion was explicitly requested for this suite.' : ' Latest promotion remains opt-in.'}`;
  const latestStatus = lifecycle.latestPromotedAt
    ? new Date(lifecycle.latestPromotedAt).toLocaleString()
    : lifecycle.promoteLatest
      ? lifecycle.status === 'running'
        ? 'Requested on completion'
        : 'Requested'
      : 'Not requested';

  const scenarioSections = manifest.scenarios
    .map((scenario) => {
      const runs = manifest.runs.filter((run) => run.scenarioId === scenario.id);
      const cards = runs
        .map((run) => {
          const variant = variantById.get(run.variantId);
          const screenshotHref = toAssetHref(manifest.paths.rootDir, run.screenshotPath);
          const screenshot = screenshotHref
            ? `<img src="${esc(screenshotHref)}" alt="${esc(run.variantLabel)} final canvas" />`
            : '<div class="missing-shot">No screenshot</div>';
          const verbs = Object.entries(run.actionSummary.byName)
            .sort((left, right) => right[1] - left[1])
            .slice(0, 6)
            .map(([name, count]) => `<span class="chip">${esc(name)} ${count}</span>`)
            .join('');
          const shapes = Object.entries(run.shapeSummary?.byType ?? {})
            .sort((left, right) => right[1] - left[1])
            .slice(0, 5)
            .map(([name, count]) => `<span class="chip">${esc(name)} ${count}</span>`)
            .join('');
          const analysis = run.visualAnalysis?.summary
            ? `<p class="analysis">${esc(run.visualAnalysis.summary)}</p>`
            : '';
          const rationale = run.visualAnalysis?.scoreRationale
            ? `<p class="analysis-subtle">${esc(run.visualAnalysis.scoreRationale)}</p>`
            : '';
          const artifactHref = toAssetHref(manifest.paths.rootDir, run.artifactPath);
          const docHref = toAssetHref(manifest.paths.rootDir, run.docPath);
          const evidenceLinks = [
            run.viewerPath ? `<a href="${esc(run.viewerPath)}">Viewer</a>` : '',
            artifactHref ? `<a href="${esc(artifactHref)}">Run JSON</a>` : '',
            docHref ? `<a href="${esc(docHref)}">Shape Doc</a>` : '',
          ]
            .filter(Boolean)
            .join('');
          return `
            <article class="run-card ${run.status}">
              <div class="run-topline">
                <div>
                  <div class="eyebrow">${esc(run.comparisonLabel)}</div>
                  <h3>${esc(run.variantLabel)}</h3>
                </div>
                <div class="score-badge">${run.score.overall}</div>
              </div>
              <div class="shot-wrap">${screenshot}</div>
              <div class="stat-grid">
                <div><span>Status</span><strong>${esc(run.status)}</strong></div>
                <div><span>TTFB</span><strong>${esc(fmtMs(run.metrics.initialTtfbMs))}</strong></div>
                <div><span>Total</span><strong>${esc(fmtMs(run.metrics.totalDurationMs))}</strong></div>
                <div><span>Tokens</span><strong>${run.usage?.totalTokens ?? 'n/a'}</strong></div>
                <div><span>Cost</span><strong>${esc(fmtUsd(run.estimatedCost?.totalUsd))}</strong></div>
                <div><span>Shapes</span><strong>${run.finalShapeCount}</strong></div>
                <div><span>Actions</span><strong>${run.metrics.totalActionCount}</strong></div>
                <div><span>Followups</span><strong>${run.metrics.totalFollowupCount}</strong></div>
              </div>
              <p class="model-line">${esc(run.resolvedModel ?? run.model ?? variant?.model ?? run.variantId)}</p>
              ${run.requestedModel && run.requestedModel !== (run.resolvedModel ?? run.model)
                ? `<p class="analysis-subtle">Requested ${esc(run.requestedModel)}</p>`
                : ''}
              <div class="chip-row">${verbs || '<span class="chip">No actions</span>'}</div>
              <div class="chip-row">${shapes || '<span class="chip">No shape inventory</span>'}</div>
              ${evidenceLinks ? `<div class="evidence-row">${evidenceLinks}</div>` : ''}
              ${analysis}
              ${rationale}
              <p class="notes">${esc(run.score.notes.join(' ') || 'No rubric notes.')}</p>
            </article>
          `;
        })
        .join('\n');
      const runGrid = cards || '<div class="empty-state">Runs for this scenario have not been written yet.</div>';

      return `
        <section class="scenario-section">
          <div class="section-head">
            <div>
              <div class="eyebrow">${esc(scenario.category)}</div>
              <h2>${esc(scenario.label)}</h2>
            </div>
            <p>${esc(scenario.description)}</p>
          </div>
          <div class="run-grid">${runGrid}</div>
        </section>
      `;
    })
    .join('\n');

  const variantSummary = manifest.summary.byVariant
    .map(
      (row) => `
        <tr>
          <td>${esc(row.label)}</td>
          <td>${row.avgScore}</td>
          <td>${esc(fmtMs(row.avgTtfbMs))}</td>
          <td>${esc(fmtMs(row.avgDurationMs))}</td>
          <td>${row.successRatePct}%</td>
        </tr>
      `,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Canvas Benchmark Suite</title>
  <style>
    :root {
      --bg: #f2ede2;
      --paper: rgba(255,255,255,0.78);
      --ink: #14110f;
      --muted: #6c655f;
      --accent: #9d3f0c;
      --line: rgba(20,17,15,0.12);
      --shadow: 0 24px 60px rgba(58, 43, 28, 0.14);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(157,63,12,0.12), transparent 28%),
        linear-gradient(180deg, #fbf7ef 0%, var(--bg) 55%, #ece2d1 100%);
      padding: 40px 28px 80px;
    }
    .shell { max-width: 1500px; margin: 0 auto; }
    .hero {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 20px;
      margin-bottom: 32px;
    }
    .hero-card, .scenario-section, .summary-card {
      background: var(--paper);
      backdrop-filter: blur(12px);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      border-radius: 28px;
    }
    .hero-card { padding: 30px; }
    .hero-card h1 { margin: 0 0 10px; font-size: 3.2rem; line-height: 0.95; }
    .hero-card p { margin: 0; color: var(--muted); font-size: 1.02rem; line-height: 1.5; }
    .summary-card { padding: 24px; }
    .summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .summary-grid div { border-top: 1px solid var(--line); padding-top: 10px; }
    .summary-grid span, .stat-grid span { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
    .summary-grid strong, .stat-grid strong { font-size: 1.1rem; }
    .status-banner {
      margin-top: 18px;
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid rgba(20,17,15,0.12);
      background: rgba(255,255,255,0.7);
    }
    .status-banner strong {
      display: block;
      font-family: "SFMono-Regular", Menlo, monospace;
      font-size: 0.82rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 6px;
    }
    .status-banner p {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
      font-size: 0.95rem;
    }
    .scenario-section { padding: 24px; margin-top: 26px; }
    .section-head { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: 18px; align-items: end; margin-bottom: 18px; }
    .section-head h2 { margin: 4px 0 0; font-size: 2rem; }
    .section-head p { margin: 0; color: var(--muted); line-height: 1.5; }
    .eyebrow { font-family: "SFMono-Regular", Menlo, monospace; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.16em; color: var(--accent); }
    .run-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .run-card { border: 1px solid var(--line); border-radius: 24px; background: rgba(255,255,255,0.72); padding: 16px; }
    .run-card.failed { border-color: rgba(157,63,12,0.3); }
    .run-topline { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .run-topline h3 { margin: 4px 0 0; font-size: 1.3rem; }
    .score-badge {
      min-width: 48px; height: 48px; border-radius: 999px; display: grid; place-items: center;
      background: #1f1b18; color: #f7f3ed; font-family: "SFMono-Regular", Menlo, monospace; font-size: 1rem;
    }
    .shot-wrap { margin-top: 14px; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 18px; border: 1px solid var(--line); background: #ece4d6; }
    .shot-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .missing-shot { width: 100%; height: 100%; display: grid; place-items: center; color: var(--muted); font-style: italic; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
    .model-line, .notes { color: var(--muted); line-height: 1.45; }
    .model-line { font-family: "SFMono-Regular", Menlo, monospace; font-size: 0.8rem; margin-top: 12px; }
    .analysis { margin: 14px 0 0; font-size: 0.96rem; line-height: 1.5; }
    .analysis-subtle { margin: 8px 0 0; font-size: 0.84rem; color: var(--muted); line-height: 1.5; }
    .chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .evidence-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    .empty-state {
      min-height: 220px;
      display: grid;
      place-items: center;
      border: 1px dashed rgba(20,17,15,0.18);
      border-radius: 22px;
      color: var(--muted);
      font-style: italic;
      background: rgba(255,255,255,0.46);
      padding: 20px;
      text-align: center;
    }
    .chip {
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(20,17,15,0.06);
      border: 1px solid rgba(20,17,15,0.08);
      font-family: "SFMono-Regular", Menlo, monospace;
      font-size: 0.72rem;
    }
    .evidence-row a {
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(20,17,15,0.08);
      color: var(--ink);
      text-decoration: none;
      font-family: "SFMono-Regular", Menlo, monospace;
      font-size: 0.72rem;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid var(--line); text-align: left; }
    th { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
    @media (max-width: 1120px) {
      .hero, .section-head, .run-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <article class="hero-card">
        <div class="eyebrow">Canvas Benchmark Suite</div>
        <h1>Side-by-side model evidence for the fairy canvas stack.</h1>
        <p>Generated ${esc(new Date(manifest.generatedAt).toLocaleString())}. This suite compares model outputs across the same scenario catalog, with screenshots, latency, action counts, and rubric scoring held in one manifest.</p>
        <div class="status-banner">
          <strong>${esc(lifecycleLabel)}</strong>
          <p>${esc(lifecycleMessage)}</p>
        </div>
      </article>
      <aside class="summary-card">
        <div class="eyebrow">Suite Summary</div>
        <div class="summary-grid">
          <div><span>Suite ID</span><strong>${esc(manifest.suiteId)}</strong></div>
          <div><span>Status</span><strong>${esc(lifecycle.status)}</strong></div>
          <div><span>Execution</span><strong>${esc(manifest.executionMode)}</strong></div>
          <div><span>Progress</span><strong>${lifecycle.writtenRuns}/${lifecycle.expectedRuns}</strong></div>
          <div><span>Success</span><strong>${manifest.summary.successRatePct}%</strong></div>
          <div><span>Latest</span><strong>${esc(latestStatus)}</strong></div>
          <div><span>Updated</span><strong>${esc(new Date(lifecycle.lastUpdatedAt).toLocaleString())}</strong></div>
        </div>
        <table>
          <thead><tr><th>Variant</th><th>Score</th><th>TTFB</th><th>Total</th><th>Success</th></tr></thead>
          <tbody>${variantSummary}</tbody>
        </table>
      </aside>
    </section>
    ${scenarioSections}
  </main>
</body>
</html>`;
}
