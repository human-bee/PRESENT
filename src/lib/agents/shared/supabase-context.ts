import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { join } from 'path';

// Ensure .env.local is loaded when running stewards/conductor in Node
try {
  config({ path: join(process.cwd(), '.env.local') });
} catch {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
if (!url || !key) {
  throw new Error('Supabase credentials missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
}
const supabase = createClient(url, key);

export async function getFlowchartDoc(room: string, docId: string) {
  // Use public.canvases.document as the single source of truth for component payloads
  // We store per-shape doc under canvases.document.components[docId]
  const { data, error } = await supabase
    .from('canvases')
    .select('document, id')
    .ilike('name', `%${room}%`)
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error(error?.message || 'NOT_FOUND');
  const components = (data.document?.components || {}) as Record<string, any>;
  const entry = components[docId] || {};
  return { doc: entry.flowchartDoc || '', format: entry.format || 'mermaid', version: entry.version || 0 };
}

export async function commitFlowchartDoc(
  room: string,
  docId: string,
  payload: { format: 'streamdown' | 'markdown' | 'mermaid'; doc: string; prevVersion?: number; rationale?: string },
) {
  // Fetch current
  const current = await getFlowchartDoc(room, docId);
  const previousVersion = current.version || 0;
  if (typeof payload.prevVersion === 'number' && payload.prevVersion !== current.version) {
    throw new Error('CONFLICT');
  }
  // Update in-place into canvases.document.components[docId]
  const { data: canvas, error: fetchErr } = await supabase
    .from('canvases')
    .select('id, document')
    .ilike('name', `%${room}%`)
    .limit(1)
    .maybeSingle();
  if (fetchErr || !canvas) throw new Error(fetchErr?.message || 'NOT_FOUND');
  const document = canvas.document || {};
  document.components = document.components || {};
  const nextVersion = (current.version || 0) + 1;
  document.components[docId] = {
    ...(document.components[docId] || {}),
    flowchartDoc: payload.doc,
    format: payload.format,
    version: nextVersion,
    rationale: payload.rationale,
    updated_at: Date.now(),
  };
  const { error: updateErr } = await supabase
    .from('canvases')
    .update({ document })
    .eq('id', canvas.id);
  if (updateErr) throw new Error(updateErr.message);
  return { version: nextVersion, previousVersion };
}

export async function getTranscriptWindow(room: string, windowMs: number) {
  // Read the latest session (room_name = room)
  const { data, error } = await supabase
    .from('canvas_sessions')
    .select('transcript')
    .eq('room_name', room)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const now = Date.now();
  const lines = (data?.transcript || []).filter((l: any) => now - (l.timestamp || 0) <= windowMs);
  return { transcript: lines };
}


