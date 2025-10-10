require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function appendTranscript(room, text) {
  const message = {
    type: 'live_transcription',
    text,
    speaker: 'user',
    timestamp: Date.now(),
    is_final: true,
    manual: true,
  };

  const payload = {
    manual: true,
    text,
    speaker: 'user',
    timestamp: Date.now(),
  };

  const { error } = await supabase
    .from('canvas_sessions')
    .update({
      transcript: supabase.sql`array_append(transcript, ${payload})`,
      updated_at: new Date().toISOString(),
    })
    .eq('room_name', room);
  if (error) throw error;
}

appendTranscript('canvas-95d98372-18ea-47fd-aab8-4d017f9d7181', 'Let us map Romeo and Juliet act one scenes.')
  .then(() => console.log('seeded transcript'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
