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
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function writeScrapbookHtml(args: ScrapbookHtmlArgs) {
  const { outputPath, title, runId, dateStamp, story, heroShots, results, perfRows, notes } = args;
  const totalMs = results.reduce((sum, step) => sum + step.durationMs, 0);
  const assetsBase = `./assets/${dateStamp}`;
  const perfRowsFormatted = perfRows.map((row) => ({
    ...row,
    status: row.durationMs <= row.budgetMs ? 'PASS' : 'WARN',
  }));

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

  const notesHtml = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('\n');

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        :root {
          color-scheme: light;
          --bg: #0b1020;
          --surface: #0f172a;
          --card: #111827;
          --accent: #38bdf8;
          --accent-2: #a78bfa;
          --text: #e2e8f0;
          --muted: #94a3b8;
          --pass: #22c55e;
          --warn: #f59e0b;
          --fail: #ef4444;
        }
        body {
          margin: 0;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background: radial-gradient(circle at top, #1e293b 0%, var(--bg) 60%);
          color: var(--text);
          padding: 32px;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        h1 { margin: 0; font-size: 28px; }
        h2 { margin: 32px 0 12px; font-size: 20px; }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
        }
        .card {
          background: var(--surface);
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 16px;
          padding: 16px;
        }
        .card h3 { margin: 0 0 8px; font-size: 14px; color: var(--muted); }
        .card p { margin: 0; font-size: 18px; font-weight: 600; }
        .hero-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 18px;
        }
        .hero-card {
          background: var(--card);
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid rgba(56, 189, 248, 0.3);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.6);
        }
        .hero-card img {
          width: 100%;
          height: auto;
          display: block;
        }
        .hero-meta { padding: 12px 14px; }
        .hero-meta h3 { margin: 0 0 6px; font-size: 16px; }
        .hero-meta p { margin: 0; font-size: 13px; color: var(--muted); }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          background: var(--card);
          border-radius: 12px;
          overflow: hidden;
        }
        th, td {
          padding: 10px 12px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.15);
        }
        th { text-align: left; background: rgba(15, 23, 42, 0.7); }
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
        a { color: var(--accent); }
        ul { padding-left: 18px; color: var(--muted); }
        .story { font-size: 15px; color: var(--muted); margin-top: 4px; }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <div class="story">${escapeHtml(story)}</div>
        </div>
        <div class="card">
          <h3>Run ID</h3>
          <p>${escapeHtml(runId)}</p>
        </div>
      </header>

      <section class="meta-grid">
        <div class="card">
          <h3>Total runtime</h3>
          <p>${totalMs} ms</p>
        </div>
        <div class="card">
          <h3>Steps captured</h3>
          <p>${results.length}</p>
        </div>
        <div class="card">
          <h3>Benchmarks</h3>
          <p>${perfRows.length}</p>
        </div>
      </section>

      <h2>Hero Moments</h2>
      <section class="hero-grid">
        ${heroMarkup || '<p>No hero shots captured.</p>'}
      </section>

      <h2>Journey Evidence</h2>
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

      <h2>Speed Benchmarks</h2>
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

      <h2>Notes</h2>
      <ul>${notesHtml || '<li>No notes added.</li>'}</ul>
    </body>
  </html>`;

  fs.writeFileSync(outputPath, html);
  console.log(`[Scrapbook] HTML report written to ${outputPath}`);
}
