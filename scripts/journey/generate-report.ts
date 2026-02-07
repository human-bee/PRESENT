import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

type JourneyEventRow = {
  id: string;
  run_id: string;
  room_name: string | null;
  event_type: string;
  source: string | null;
  tool: string | null;
  duration_ms: number | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const createSupabase = () => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
};

const summarizeDurations = (events: JourneyEventRow[]) => {
  const durations = events
    .filter((event) => typeof event.duration_ms === 'number')
    .map((event) => event.duration_ms as number);
  if (durations.length === 0) return { avg: 0, max: 0 };
  const sum = durations.reduce((acc, value) => acc + value, 0);
  return { avg: Math.round(sum / durations.length), max: Math.max(...durations) };
};

const renderAssets = (events: JourneyEventRow[]) => {
  const assets = events.filter((event) => event.event_type === 'asset');
  if (assets.length === 0) return '<p>No assets captured.</p>';
  return `
    <div class="asset-grid">
      ${assets
        .map((event) => {
          const payload = event.payload || {};
          const src = String((payload as any).path || (payload as any).url || '');
          const label = String((payload as any).label || event.source || 'asset');
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
};

const renderTimeline = (events: JourneyEventRow[]) => {
  return `
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Source</th>
          <th>Tool</th>
          <th>Duration (ms)</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        ${events
          .map((event) => {
            const payload = event.payload || {};
            const note =
              typeof (payload as any).text === 'string'
                ? (payload as any).text
                : (payload as any).message || '';
            return `
              <tr>
                <td>${escapeHtml(new Date(event.created_at).toLocaleTimeString())}</td>
                <td>${escapeHtml(event.event_type)}</td>
                <td>${escapeHtml(event.source || '')}</td>
                <td>${escapeHtml(event.tool || '')}</td>
                <td>${event.duration_ms ?? ''}</td>
                <td>${escapeHtml(String(note).slice(0, 180))}</td>
              </tr>
            `;
          })
          .join('\n')}
      </tbody>
    </table>
  `;
};

const buildHtml = (runId: string, roomName: string | null, events: JourneyEventRow[]) => {
  const toolCalls = events.filter((event) => event.event_type === 'tool_call');
  const toolResults = events.filter((event) => event.event_type === 'tool_result');
  const mcpCalls = events.filter((event) => event.event_type === 'mcp_call');
  const mcpResults = events.filter((event) => event.event_type === 'mcp_result');
  const ttsEvents = events.filter((event) => event.event_type.startsWith('tts'));
  const audioEvents = events.filter((event) => event.event_type === 'audio_publish');
  const utterances = events.filter((event) => event.event_type === 'utterance');
  const assets = events.filter((event) => event.event_type === 'asset');
  const durations = summarizeDurations(toolResults);
  const speedGrade = durations.avg <= 800 ? 'FAST' : durations.avg <= 1400 ? 'OK' : 'SLOW';
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.event_type] = (acc[event.event_type] || 0) + 1;
    return acc;
  }, {});

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>PRESENT Journey Report (${escapeHtml(runId)})</title>
      <style>
        body { font-family: Inter, system-ui, sans-serif; margin: 32px; color: #101828; background: #f8fafc; }
        h1, h2 { margin: 0 0 12px; }
        .meta { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 24px; }
        .card { background: white; border-radius: 16px; padding: 16px 20px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
        th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
        th { background: #f1f5f9; }
        .asset-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
        figure { margin: 0; background: white; border-radius: 14px; padding: 10px; box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08); }
        figure img { width: 100%; border-radius: 12px; display: block; }
        figcaption { font-size: 12px; color: #475569; margin-top: 6px; }
      </style>
    </head>
    <body>
      <h1>PRESENT Journey Report</h1>
      <div class="meta">
        <div class="card"><strong>Run ID</strong><div>${escapeHtml(runId)}</div></div>
        <div class="card"><strong>Room</strong><div>${escapeHtml(roomName || '')}</div></div>
        <div class="card"><strong>Tool Calls</strong><div>${toolCalls.length}</div></div>
        <div class="card"><strong>Tool Results</strong><div>${toolResults.length}</div></div>
        <div class="card"><strong>MCP Calls</strong><div>${mcpCalls.length}</div></div>
        <div class="card"><strong>Utterances</strong><div>${utterances.length}</div></div>
        <div class="card"><strong>Assets</strong><div>${assets.length}</div></div>
        <div class="card"><strong>TTS Events</strong><div>${ttsEvents.length}</div></div>
        <div class="card"><strong>Audio Publishes</strong><div>${audioEvents.length}</div></div>
        <div class="card"><strong>Avg Tool Time</strong><div>${durations.avg} ms</div></div>
        <div class="card"><strong>Max Tool Time</strong><div>${durations.max} ms</div></div>
        <div class="card"><strong>Speed Grade</strong><div>${speedGrade}</div></div>
      </div>

      <h2>Assets</h2>
      ${renderAssets(events)}

      <h2>Event Breakdown</h2>
      <table>
        <thead>
          <tr>
            <th>Event Type</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(counts)
            .map(
              ([key, value]) => `
                <tr>
                  <td>${escapeHtml(key)}</td>
                  <td>${value}</td>
                </tr>
              `,
            )
            .join('\n')}
        </tbody>
      </table>

      <h2>Timeline</h2>
      ${renderTimeline(events)}
    </body>
  </html>`;
};

const main = async () => {
  const runId = process.argv[2];
  if (!runId) {
    throw new Error('Usage: tsx scripts/journey/generate-report.ts <runId> [outputPath]');
  }
  const outputPath =
    process.argv[3] ||
    path.join(process.cwd(), 'docs', 'scrapbooks', `${runId}-journey-report.html`);

  const supabase = createSupabase();
  if (!supabase) {
    throw new Error('Supabase credentials missing for journey report');
  }

  const { data, error } = await supabase
    .from('present_journey_events')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const events = (data || []) as JourneyEventRow[];
  const roomName = events.find((event) => event.room_name)?.room_name || null;
  const html = buildHtml(runId, roomName, events);
  fs.writeFileSync(outputPath, html);
  console.log(`[Journey] Report written to ${outputPath}`);
};

main().catch((error) => {
  console.error('[Journey] Failed to generate report', error);
  process.exit(1);
});
