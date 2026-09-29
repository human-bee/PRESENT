import type { TranscriptEntry } from '../../shared/transcript';
import type { VoiceTranscript } from './realtime-events';

export function mergeVoiceTranscript(saved: Pick<TranscriptEntry, 'id' | 'role' | 'text'>[], live: VoiceTranscript[]): VoiceTranscript[] {
  const entries = new Map(saved.map(item => [item.id, { id: item.id, role: item.role, text: item.text, final: true }]));
  // A durable final caption wins over a late partial echo. Unsaved live fragments remain visible.
  for (const item of live) if (!entries.has(item.id)) entries.set(item.id, item);
  return [...entries.values()].slice(-60);
}
