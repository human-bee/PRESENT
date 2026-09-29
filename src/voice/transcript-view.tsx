import { TLDOCUMENT_ID, useValue, type Editor } from 'tldraw';
import { readTranscriptWindow } from '../../shared/transcript';
import type { VoiceTranscript } from './realtime-events';
import { mergeVoiceTranscript } from './transcript-window';

/** Mounted only while open, subscribed to the document rather than moving shapes. */
export function VoiceTranscriptView({ editor, live }: { editor: Editor | null; live: VoiceTranscript[] }) {
  const saved = useValue('voice transcript history', () => {
    const document = editor?.store.get(TLDOCUMENT_ID);
    return readTranscriptWindow(document ? [document] : []);
  }, [editor]);
  const entries = mergeVoiceTranscript(saved.entries, live);
  return <>
    {saved.omitted > 0 && <small className="voice-note">Recent conversation retained. {saved.omitted} older captions have been trimmed.</small>}
    <div className="voice-transcript" aria-live="polite">{entries.length ? entries.map(item => <p key={item.id} className={item.role}><small>{item.role === 'assistant' ? 'PRESENT' : 'In the room'}</small>{item.text}</p>) : <p className="voice-empty">Words appear here as the conversation unfolds.</p>}</div>
  </>;
}
