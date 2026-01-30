import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { broadcastTranscription } from '@/lib/agents/shared/supabase-context';

type JourneyLine = {
  speaker: string;
  text: string;
  delayMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getArg = (name: string) => {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return '';
  return process.argv[idx + 1] || '';
};

const loadScript = (filePath: string): JourneyLine[] => {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Journey script must be a JSON array');
  }
  return parsed.map((entry) => ({
    speaker: String(entry?.speaker || 'user'),
    text: String(entry?.text || ''),
    delayMs: typeof entry?.delayMs === 'number' ? entry.delayMs : undefined,
  }));
};

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

const logEvent = async (supabase: ReturnType<typeof createSupabase>, payload: Record<string, unknown>) => {
  if (!supabase) return;
  await supabase.from('present_journey_events').insert(payload);
};

const main = async () => {
  const room = getArg('--room') || process.env.JOURNEY_ROOM || 'canvas-journey';
  const runId = getArg('--run') || process.env.JOURNEY_RUN_ID || randomUUID();
  const scriptArg = getArg('--script');
  const scriptPath =
    scriptArg ||
    path.join(process.cwd(), 'scripts', 'journey', 'sample-script.json');

  const lines = loadScript(scriptPath);
  const supabase = createSupabase();

  await logEvent(supabase, {
    run_id: runId,
    room_name: room,
    event_type: 'run_start',
    source: 'journey-script',
    payload: { scriptPath, lineCount: lines.length },
  });

  for (const line of lines) {
    const delay = typeof line.delayMs === 'number' ? line.delayMs : 1200;
    await sleep(delay);
    await broadcastTranscription({
      room,
      text: line.text,
      speaker: line.speaker,
      manual: true,
    });
    await logEvent(supabase, {
      run_id: runId,
      room_name: room,
      event_type: 'utterance',
      source: line.speaker,
      payload: { text: line.text },
    });
  }

  await logEvent(supabase, {
    run_id: runId,
    room_name: room,
    event_type: 'run_end',
    source: 'journey-script',
    payload: { lineCount: lines.length },
  });

  console.log(`[Journey] Completed run ${runId} in room ${room}`);
};

main().catch((error) => {
  console.error('[Journey] Failed to run script', error);
  process.exit(1);
});
