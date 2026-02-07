import fs from 'node:fs';
import path from 'node:path';
import type { StepResult } from '../fairy-lap-utils';

type PerfRow = {
  label: string;
  durationMs: number;
  budgetMs: number;
};

type HeroShot = {
  title: string;
  screenshot?: string;
  caption?: string;
};

type JourneyEventRow = {
  event_type: string;
  source: string | null;
  tool: string | null;
  duration_ms: number | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type ScrapbookHtmlArgs = {
  outputPath: string;
  title: string;
  runId: string;
  dateStamp: string;
  story: string;
  heroShots: HeroShot[];
  results: StepResult[];
  perfRows: PerfRow[];
  notes: string[];
  journeyEvents?: JourneyEventRow[];
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatClock = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
};

export function writeScrapbookHtml(args: ScrapbookHtmlArgs) {
  const {
    outputPath,
    title,
    runId,
    dateStamp,
    story,
    heroShots,
    results,
    perfRows,
    notes,
    journeyEvents = [],
  } = args;

  const totalMs = results.reduce((sum, step) => sum + step.durationMs, 0);
  const assetsBase = `./assets/${dateStamp}`;
  const perfRowsFormatted = perfRows.map((row) => ({
    ...row,
    status: row.durationMs <= row.budgetMs ? 'PASS' : 'WARN',
  }));

  const transcripts = journeyEvents.filter((event) => event.event_type === 'transcript');
  const toolMetrics = journeyEvents.filter((event) => event.event_type === 'tool_metrics');
  const toolTimeline = journeyEvents.filter((event) =>
    ['tool_call', 'tool_result', 'tool_error', 'tool_metrics', 'decision', 'resolve', 'ui_mount'].includes(
      event.event_type,
    ),
  );
  const mcpTimeline = journeyEvents.filter((event) => event.event_type.startsWith('mcp_'));
  const assetEvents = journeyEvents.filter((event) => event.event_type === 'asset');

  const paintValues = toolMetrics
    .map((event) => {
      const payload = event.payload || {};
      const paint = payload.dtPaintMs ?? event.duration_ms ?? null;
      return typeof paint === 'number' ? paint : null;
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  const avgPaint =
    paintValues.length > 0
      ? Math.round(paintValues.reduce((sum, value) => sum + value, 0) / paintValues.length)
      : 0;
  const p95Paint = Math.round(percentile(paintValues, 0.95));
  const p90Paint = Math.round(percentile(paintValues, 0.9));
  const p50Paint = Math.round(percentile(paintValues, 0.5));
  const networkValues = toolMetrics
    .map((event) => {
      const payload = event.payload || {};
      const net = payload.dtNetworkMs ?? null;
      return typeof net === 'number' ? net : null;
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const avgNetwork =
    networkValues.length > 0
      ? Math.round(networkValues.reduce((sum, value) => sum + value, 0) / networkValues.length)
      : 0;
  const latencyGrade = avgPaint <= 800 ? 'FAST' : avgPaint <= 1400 ? 'OK' : 'SLOW';

  const toolCounts = journeyEvents.reduce<Record<string, number>>((acc, event) => {
    const key = event.event_type;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const toolCallCount = toolCounts.tool_call || 0;
  const toolResultCount = toolCounts.tool_result || 0;
  const toolErrorCount = toolCounts.tool_error || 0;
  const mcpCallCount = toolCounts.mcp_call || 0;
  const mcpResultCount = toolCounts.mcp_result || 0;
  const mcpErrorCount = toolCounts.mcp_error || 0;
  const totalMinutes = Math.max(0.1, totalMs / 60_000);
  const toolThroughput = Math.round(toolResultCount / totalMinutes);

  const assetByTool = assetEvents.reduce<Record<string, number>>((acc, event) => {
    const label =
      event.tool ||
      String((event.payload || {})?.name || (event.payload || {})?.label || 'asset');
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const heroMarkup = heroShots
    .filter((shot) => shot.screenshot)
    .map((shot) => {
      const src = `${assetsBase}/${shot.screenshot}`;
      return `
        <article class="hero-card">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(shot.title)}" />
          <div class="hero-meta">
            <h3>${escapeHtml(shot.title)}</h3>
            ${shot.caption ? `<p>${escapeHtml(shot.caption)}</p>` : ''}
          </div>
        </article>
      `;
    })
    .join('\n');

  const timelineRows = results
    .map((step) => {
      const screenshot = step.screenshot ? `${assetsBase}/${step.screenshot}` : '';
      const notesText = step.error ? `FAIL: ${step.error}` : step.notes || '';
      return `
        <tr>
          <td>${escapeHtml(step.name)}</td>
          <td><span class="pill ${step.status === 'PASS' ? 'pill-pass' : 'pill-fail'}">${step.status}</span></td>
          <td>${step.durationMs}</td>
          <td>${screenshot ? `<a href="${escapeHtml(screenshot)}">view</a>` : ''}</td>
          <td>${escapeHtml(notesText)}</td>
        </tr>
      `;
    })
    .join('\n');

  const perfRowsHtml = perfRowsFormatted
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${row.durationMs}</td>
          <td>${row.budgetMs}</td>
          <td><span class="pill ${row.status === 'PASS' ? 'pill-pass' : 'pill-warn'}">${row.status}</span></td>
        </tr>
      `,
    )
    .join('\n');

  const perfCardsHtml =
    perfRowsFormatted.length === 0
      ? '<p class="empty">No performance measurements captured.</p>'
      : `
        <div class="perf-grid">
          ${perfRowsFormatted
            .map((row) => {
              const ratio = row.budgetMs > 0 ? row.durationMs / row.budgetMs : 0;
              const width = Math.min(160, Math.max(6, Math.round(ratio * 100)));
              return `
                <div class="perf-card">
                  <div class="perf-title">${escapeHtml(row.label)}</div>
                  <div class="perf-meta">${row.durationMs} ms / ${row.budgetMs} ms</div>
                  <div class="perf-bar">
                    <span class="${row.status === 'PASS' ? 'bar-pass' : 'bar-warn'}" style="width:${width}%"></span>
                  </div>
                </div>
              `;
            })
            .join('\n')}
        </div>
      `;

  const transcriptHtml =
    transcripts.length === 0
      ? '<p class="empty">No transcript events captured.</p>'
      : `
        <div class="transcript-list">
          ${transcripts
            .map((event) => {
              const payload = event.payload || {};
              const speaker =
                String((payload as any).speaker || event.source || 'speaker');
              const text = String((payload as any).text || '').trim();
              const timestamp = formatClock(event.created_at);
              return `
                <div class="transcript-row">
                  <div class="transcript-time">${escapeHtml(timestamp)}</div>
                  <div class="transcript-speaker">${escapeHtml(speaker)}</div>
                  <div class="transcript-text">${escapeHtml(text)}</div>
                </div>
              `;
            })
            .join('\n')}
        </div>
      `;

  const toolTimelineHtml =
    toolTimeline.length === 0
      ? '<p class="empty">No tool events captured.</p>'
      : `
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Tool</th>
              <th>Duration</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${toolTimeline
              .map((event) => {
                const payload = event.payload || {};
                const note =
                  (payload as any).message ||
                  (payload as any).summary ||
                  (payload as any).componentType ||
                  '';
                return `
                  <tr>
                    <td>${escapeHtml(formatClock(event.created_at))}</td>
                    <td>${escapeHtml(event.event_type)}</td>
                    <td>${escapeHtml(event.tool || '')}</td>
                    <td>${event.duration_ms ?? ''}</td>
                    <td>${escapeHtml(String(note).slice(0, 120))}</td>
                  </tr>
                `;
              })
              .join('\n')}
          </tbody>
        </table>
      `;

  const mcpTimelineHtml =
    mcpTimeline.length === 0
      ? '<p class="empty">No MCP events captured.</p>'
      : `
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Tool</th>
              <th>Duration</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${mcpTimeline
              .map((event) => {
                const payload = event.payload || {};
                const note = (payload as any).error || (payload as any).result || '';
                return `
                  <tr>
                    <td>${escapeHtml(formatClock(event.created_at))}</td>
                    <td>${escapeHtml(event.event_type)}</td>
                    <td>${escapeHtml(event.tool || '')}</td>
                    <td>${event.duration_ms ?? ''}</td>
                    <td>${escapeHtml(String(note).slice(0, 120))}</td>
                  </tr>
                `;
              })
              .join('\n')}
          </tbody>
        </table>
      `;

  const assetTimelineHtml =
    assetEvents.length === 0
      ? '<p class="empty">No UI assets logged.</p>'
      : `
        <div class="asset-grid">
          ${assetEvents
            .map((event) => {
              const payload = event.payload || {};
              const src = String((payload as any).path || (payload as any).url || '');
              const label =
                String((payload as any).label || (payload as any).name || event.tool || 'asset');
              return `
                <figure>
                  ${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" />` : ''}
                  <figcaption>${escapeHtml(label)}</figcaption>
                </figure>
              `;
            })
            .join('\n')}
        </div>
      `;

  const widgetCoverageHtml =
    Object.keys(assetByTool).length === 0
      ? '<p class="empty">No widgets logged.</p>'
      : `
        <div class="chip-grid">
          ${Object.entries(assetByTool)
            .map(
              ([label, count]) => `
                <div class="chip">
                  <span>${escapeHtml(label)}</span>
                  <strong>${count}</strong>
                </div>
              `,
            )
            .join('\n')}
        </div>
      `;

  const breakdownHtml =
    Object.keys(toolCounts).length === 0
      ? '<p class="empty">No journey events recorded.</p>'
      : `
        <div class="chip-grid">
          ${Object.entries(toolCounts)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([label, count]) => `
                <div class="chip">
                  <span>${escapeHtml(label.replaceAll('_', ' '))}</span>
                  <strong>${count}</strong>
                </div>
              `,
            )
            .join('\n')}
        </div>
      `;

  const pulseEvents = journeyEvents.filter((event) =>
    [
      'transcript',
      'tool_call',
      'tool_result',
      'tool_error',
      'tool_metrics',
      'mcp_call',
      'mcp_result',
      'mcp_error',
      'decision',
      'resolve',
      'ui_mount',
    ].includes(event.event_type),
  );

  const pulseHtml =
    pulseEvents.length === 0
      ? '<p class="empty">No system pulse events recorded.</p>'
      : `
        <div class="pulse-list">
          ${pulseEvents
            .slice(-140)
            .map((event) => {
              const payload = event.payload || {};
              const label =
                String(
                  (payload as any).label ||
                    (payload as any).summary ||
                    (payload as any).message ||
                    '',
                );
              return `
                <div class="pulse-row">
                  <span class="pulse-time">${escapeHtml(formatClock(event.created_at))}</span>
                  <span class="pulse-type">${escapeHtml(event.event_type)}</span>
                  <span class="pulse-tool">${escapeHtml(event.tool || '')}</span>
                  <span class="pulse-note">${escapeHtml(label.slice(0, 120))}</span>
                </div>
              `;
            })
            .join('\n')}
        </div>
      `;

  const notesHtml = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('\n');

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
      <style>
        :root {
          color-scheme: light;
          --bg: #05070f;
          --surface: rgba(12, 18, 35, 0.9);
          --card: rgba(15, 23, 42, 0.92);
          --accent: #38bdf8;
          --accent-2: #a78bfa;
          --text: #e2e8f0;
          --muted: #94a3b8;
          --pass: #22c55e;
          --warn: #f59e0b;
          --fail: #ef4444;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: 'Space Grotesk', system-ui, sans-serif;
          background:
            radial-gradient(1200px 600px at 15% -10%, rgba(56, 189, 248, 0.35), transparent 60%),
            radial-gradient(800px 500px at 85% 0%, rgba(167, 139, 250, 0.3), transparent 60%),
            var(--bg);
          color: var(--text);
          padding: 40px 32px 80px;
        }
        header {
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 24px;
          align-items: start;
        }
        h1 { margin: 0; font-size: 32px; letter-spacing: -0.02em; }
        h2 { margin: 36px 0 16px; font-size: 20px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
        h3 { margin: 0 0 6px; font-size: 16px; }
        .story { font-size: 15px; color: var(--muted); margin-top: 8px; max-width: 720px; }
        .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); }
        .card {
          background: var(--surface);
          border: 1px solid rgba(148, 163, 184, 0.15);
          border-radius: 16px;
          padding: 16px 18px;
          box-shadow: 0 16px 40px rgba(2, 6, 23, 0.55);
        }
        .run-card { display: flex; flex-direction: column; gap: 8px; }
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 14px;
          margin-top: 24px;
        }
        .stat {
          background: var(--card);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 14px;
          padding: 12px 14px;
        }
        .stat span { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
        .stat strong { font-size: 18px; margin-top: 6px; display: block; }
        .pill {
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .pill-pass { background: rgba(34, 197, 94, 0.2); color: var(--pass); }
        .pill-warn { background: rgba(245, 158, 11, 0.2); color: var(--warn); }
        .pill-fail { background: rgba(239, 68, 68, 0.2); color: var(--fail); }
        .hero-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 18px;
        }
        .hero-card {
          background: var(--card);
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid rgba(56, 189, 248, 0.35);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.6);
        }
        .hero-card img { width: 100%; display: block; }
        .hero-meta { padding: 12px 14px; }
        .hero-meta p { margin: 0; font-size: 12px; color: var(--muted); }
        .perf-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }
        .perf-card {
          background: var(--card);
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          padding: 12px 14px;
        }
        .perf-title { font-size: 13px; font-weight: 600; }
        .perf-meta { font-size: 12px; color: var(--muted); margin-top: 6px; }
        .perf-bar {
          margin-top: 10px;
          height: 8px;
          background: rgba(148, 163, 184, 0.2);
          border-radius: 999px;
          overflow: hidden;
        }
        .perf-bar span { display: block; height: 100%; border-radius: 999px; }
        .bar-pass { background: linear-gradient(90deg, rgba(34, 197, 94, 0.4), rgba(34, 197, 94, 0.9)); }
        .bar-warn { background: linear-gradient(90deg, rgba(245, 158, 11, 0.4), rgba(245, 158, 11, 0.9)); }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          background: var(--card);
          border-radius: 12px;
          overflow: hidden;
        }
        th, td { padding: 10px 12px; border-bottom: 1px solid rgba(148, 163, 184, 0.12); }
        th { text-align: left; background: rgba(15, 23, 42, 0.65); }
        a { color: var(--accent); }
        .section-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 20px;
        }
        .transcript-list {
          display: grid;
          gap: 8px;
        }
        .transcript-row {
          display: grid;
          grid-template-columns: 84px 120px 1fr;
          gap: 10px;
          padding: 10px 12px;
          background: rgba(15, 23, 42, 0.6);
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.12);
        }
        .transcript-time { font-size: 11px; color: var(--muted); }
        .transcript-speaker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); }
        .transcript-text { font-size: 14px; }
        .asset-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }
        figure { margin: 0; background: var(--card); border-radius: 14px; padding: 10px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.5); }
        figure img { width: 100%; border-radius: 12px; display: block; }
        figcaption { font-size: 12px; color: var(--muted); margin-top: 6px; }
        .chip-grid { display: flex; flex-wrap: wrap; gap: 10px; }
        .chip { display: flex; align-items: center; gap: 8px; border-radius: 999px; background: rgba(56, 189, 248, 0.12); color: var(--text); padding: 6px 12px; font-size: 12px; }
        .chip strong { color: var(--accent); font-size: 12px; }
        ul { padding-left: 18px; color: var(--muted); }
        .empty { color: var(--muted); }
        .pulse-list { display: grid; gap: 8px; }
        .pulse-row {
          display: grid;
          grid-template-columns: 90px 130px 160px 1fr;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.55);
          border: 1px solid rgba(148, 163, 184, 0.14);
          font-size: 12px;
        }
        .pulse-time { color: var(--muted); font-family: 'JetBrains Mono', monospace; }
        .pulse-type { text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-2); font-size: 11px; }
        .pulse-tool { color: var(--accent); font-weight: 600; }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <div class="story">${escapeHtml(story)}</div>
          <div class="mono">Run ID: ${escapeHtml(runId)}</div>
        </div>
        <div class="card run-card">
          <div class="mono">Total runtime</div>
          <div style="font-size: 22px; font-weight: 700;">${totalMs} ms</div>
          <div class="mono">Latency grade</div>
          <div style="font-size: 18px; font-weight: 600;">${escapeHtml(latencyGrade)}</div>
        </div>
      </header>

      <section class="stat-grid">
        <div class="stat"><span>Transcript turns</span><strong>${transcripts.length}</strong></div>
        <div class="stat"><span>Tool calls</span><strong>${toolCallCount}</strong></div>
        <div class="stat"><span>Tool results</span><strong>${toolResultCount}</strong></div>
        <div class="stat"><span>Tool errors</span><strong>${toolErrorCount}</strong></div>
        <div class="stat"><span>MCP calls</span><strong>${mcpCallCount}</strong></div>
        <div class="stat"><span>MCP results</span><strong>${mcpResultCount}</strong></div>
        <div class="stat"><span>MCP errors</span><strong>${mcpErrorCount}</strong></div>
        <div class="stat"><span>Assets captured</span><strong>${assetEvents.length}</strong></div>
        <div class="stat"><span>Avg paint</span><strong>${avgPaint} ms</strong></div>
        <div class="stat"><span>Avg network</span><strong>${avgNetwork} ms</strong></div>
        <div class="stat"><span>Tool throughput</span><strong>${toolThroughput}/min</strong></div>
        <div class="stat"><span>P50 paint</span><strong>${p50Paint} ms</strong></div>
        <div class="stat"><span>P90 paint</span><strong>${p90Paint} ms</strong></div>
        <div class="stat"><span>P95 paint</span><strong>${p95Paint} ms</strong></div>
      </section>

      <h2>Hero moments</h2>
      <section class="hero-grid">
        ${heroMarkup || '<p class="empty">No hero shots captured.</p>'}
      </section>

      <h2>Conversation timeline</h2>
      <div class="card">
        ${transcriptHtml}
      </div>

      <h2>Widget coverage</h2>
      <div class="card">
        ${widgetCoverageHtml}
      </div>

      <h2>Journey evidence</h2>
      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Status</th>
            <th>Duration (ms)</th>
            <th>Screenshot</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${timelineRows}
        </tbody>
      </table>

      <h2>Speed benchmarks</h2>
      ${perfCardsHtml}
      <table>
        <thead>
          <tr>
            <th>Operation</th>
            <th>Duration (ms)</th>
            <th>Budget (ms)</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          ${perfRowsHtml}
        </tbody>
      </table>

      <h2>System pulse</h2>
      <div class="card">
        ${pulseHtml}
      </div>

      <h2>Tool call timeline</h2>
      ${toolTimelineHtml}

      <h2>MCP timeline</h2>
      ${mcpTimelineHtml}

      <h2>Assets</h2>
      ${assetTimelineHtml}

      <h2>Event breakdown</h2>
      <div class="card">
        ${breakdownHtml}
      </div>

      <h2>Notes</h2>
      <ul>${notesHtml || '<li>No notes added.</li>'}</ul>
    </body>
  </html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log(`[Scrapbook] HTML report written to ${outputPath}`);
}
