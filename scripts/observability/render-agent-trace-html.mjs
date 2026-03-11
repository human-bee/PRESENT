#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const fmtBool = (value) => (value ? 'yes' : 'no');

const fmtDate = (value) => {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return String(value);
  return parsed.toISOString();
};

const summarizeStageCounts = (result) => {
  const summary = result?.sessionCorrelation?.body?.summary;
  const stageCounts = summary?.traceStageCounts;
  if (!stageCounts || typeof stageCounts !== 'object') return [];
  return Object.entries(stageCounts)
    .map(([stage, count]) => ({
      stage,
      count: Number.isFinite(Number(count)) ? Number(count) : 0,
    }))
    .sort((a, b) => b.count - a.count);
};

const summarizeFairyTasks = (result) => {
  const tasks = Array.isArray(result?.sessionCorrelation?.body?.tasks)
    ? result.sessionCorrelation.body.tasks
    : [];
  return tasks
    .filter((task) => String(task?.task || '') === 'fairy.intent')
    .slice(0, 40)
    .map((task) => ({
      id: String(task?.id || ''),
      status: String(task?.status || ''),
      traceId:
        typeof task?.trace_id === 'string'
          ? task.trace_id
          : typeof task?.resolved_trace_id === 'string'
            ? task.resolved_trace_id
          : typeof task?.traceId === 'string'
            ? task.traceId
            : '',
      error: String(task?.error || ''),
      updatedAt: String(task?.updated_at || task?.updatedAt || ''),
    }));
};

const renderTurns = (result) => {
  const turns = Array.isArray(result?.turns) ? result.turns : [];
  if (!turns.length) {
    return '<p class="empty">No turns recorded.</p>';
  }
  const rows = turns
    .map((turn, index) => {
      const elapsed = Number.isFinite(Number(turn?.elapsedMs)) ? Number(turn.elapsedMs) : null;
      return `<tr>
  <td>${index + 1}</td>
  <td>${escapeHtml(turn?.prompt || '')}</td>
  <td>${fmtBool(Boolean(turn?.acked))}</td>
  <td>${fmtBool(Boolean(turn?.delivered))}</td>
  <td>${elapsed === null ? 'n/a' : `${elapsed} ms`}</td>
</tr>`;
    })
    .join('\n');

  return `<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Prompt</th>
      <th>Acked</th>
      <th>Delivered</th>
      <th>Elapsed</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`;
};

const renderStageCounts = (result) => {
  const rows = summarizeStageCounts(result);
  if (!rows.length) {
    return '<p class="empty">No stage counts available.</p>';
  }
  return `<table>
  <thead><tr><th>Stage</th><th>Count</th></tr></thead>
  <tbody>
${rows
  .map(
    (row) => `<tr>
  <td>${escapeHtml(row.stage)}</td>
  <td>${row.count}</td>
</tr>`,
  )
  .join('\n')}
  </tbody>
</table>`;
};

const renderFairyTasks = (result) => {
  const rows = summarizeFairyTasks(result);
  if (!rows.length) {
    return '<p class="empty">No fairy.intent tasks available.</p>';
  }
  return `<table>
  <thead><tr><th>Task</th><th>Status</th><th>Trace</th><th>Updated</th><th>Error</th></tr></thead>
  <tbody>
${rows
  .map(
    (row) => `<tr>
  <td>${escapeHtml(row.id)}</td>
  <td>${escapeHtml(row.status)}</td>
  <td>${escapeHtml(row.traceId)}</td>
  <td>${escapeHtml(row.updatedAt)}</td>
  <td>${escapeHtml(row.error)}</td>
</tr>`,
  )
  .join('\n')}
  </tbody>
</table>`;
};

const renderAssetLinks = (result) => {
  const links = [];
  if (typeof result?.video === 'string' && result.video.trim().length > 0) {
    links.push(`<li><a href="${escapeHtml(result.video)}">video</a></li>`);
  }
  if (Array.isArray(result?.screenshots)) {
    for (const shot of result.screenshots.slice(0, 24)) {
      if (typeof shot === 'string' && shot.trim().length > 0) {
        links.push(`<li><a href="${escapeHtml(shot)}">${escapeHtml(path.basename(shot))}</a></li>`);
      }
    }
  }
  if (!links.length) {
    return '<p class="empty">No assets linked.</p>';
  }
  return `<ul>${links.join('')}</ul>`;
};

export const renderAgentTraceHtml = (result) => {
  const proof = result?.proof && typeof result.proof === 'object' ? result.proof : {};
  const notes = Array.isArray(result?.notes) ? result.notes : [];
  const agentReady =
    typeof result?.agentReady === 'boolean'
      ? result.agentReady
      : Boolean(result?.joined || proof?.joined);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Trace Report</title>
  <style>
    body { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2937; background: #f8fafc; }
    h1, h2 { margin: 0 0 12px; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; vertical-align: top; text-align: left; }
    th { background: #f1f5f9; }
    .meta { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; font-size: 13px; }
    .chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; border: 1px solid #cbd5e1; background: #f8fafc; margin-right: 6px; }
    .empty { color: #64748b; font-style: italic; }
    ul { margin: 8px 0 0 18px; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Agent Trace Report</h1>
  <section>
    <h2>Run Metadata</h2>
    <div class="meta">
      <div><strong>Run ID:</strong> ${escapeHtml(result?.runId || 'n/a')}</div>
      <div><strong>Canvas ID:</strong> ${escapeHtml(result?.canvasId || 'n/a')}</div>
      <div><strong>Room:</strong> ${escapeHtml(result?.room || 'n/a')}</div>
      <div><strong>Started:</strong> ${escapeHtml(fmtDate(result?.startedAt))}</div>
      <div><strong>Ended:</strong> ${escapeHtml(fmtDate(result?.endedAt))}</div>
      <div><strong>Joined:</strong> ${fmtBool(Boolean(result?.joined || proof?.joined))}</div>
      <div><strong>Agent Ready:</strong> ${fmtBool(agentReady)}</div>
      <div><strong>Trace ID:</strong> ${escapeHtml(proof?.traceId || 'n/a')}</div>
    </div>
  </section>
  <section>
    <h2>Proof Summary</h2>
    <div>
      <span class="chip">actions_dispatched: ${Number(proof?.actionsDispatchedCount ?? 0)}</span>
      <span class="chip">executing: ${Number(proof?.executingCount ?? 0)}</span>
      <span class="chip">fairy_clean_succeeded: ${Number(proof?.cleanFairySucceededCount ?? 0)}</span>
      <span class="chip">fairy_completed_traces: ${Number(proof?.completedFairyTraces ?? 0)}</span>
      <span class="chip">missingTraceOnTasks: ${Number(proof?.missingTraceOnTasks ?? 0)}</span>
      <span class="chip">missingTraceOnTrackedTasks: ${Number(proof?.missingTraceOnTrackedTasks ?? 0)}</span>
      <span class="chip">zodErrors: ${Number(proof?.zodErrorCount ?? 0)}</span>
    </div>
  </section>
  <section>
    <h2>Turn Timeline</h2>
    ${renderTurns(result)}
  </section>
  <section>
    <h2>Trace Stage Counts</h2>
    ${renderStageCounts(result)}
  </section>
  <section>
    <h2>Fairy Task Rows</h2>
    ${renderFairyTasks(result)}
  </section>
  <section>
    <h2>Assets</h2>
    ${renderAssetLinks(result)}
  </section>
  <section>
    <h2>Notes</h2>
    ${
      notes.length
        ? `<ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
        : '<p class="empty">No notes.</p>'
    }
  </section>
</body>
</html>`;
};

export const writeAgentTraceHtml = async ({
  result,
  outputDir,
  fileName = 'agent-trace.html',
}) => {
  const html = renderAgentTraceHtml(result);
  const htmlPath = path.join(outputDir, fileName);
  await fs.writeFile(htmlPath, `${html}\n`, 'utf8');
  return htmlPath;
};
