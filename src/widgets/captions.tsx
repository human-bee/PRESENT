import { useEditor, useValue } from 'tldraw';
import { readTranscriptWindow } from '../../shared/transcript';

export function SharedCaptions() {
  const editor = useEditor();
  const transcript = useValue('shared captions', () => readTranscriptWindow(editor.store.allRecords()), [editor]);
  const captions = transcript.entries.slice(-30);
  return <section className="shared-captions" aria-label="Shared captions">
    <p className="caption-note">Final captions appear while a participant has listening on. Room audio may include several speakers.</p>
    {transcript.omitted > 0 && <p className="caption-note">Showing recent captions. Older captions have been trimmed from the room.</p>}
    <div aria-live="polite">{captions.length ? [...captions].reverse().map(entry => <p key={entry.id}><small>{entry.role === 'assistant' ? 'PRESENT' : 'Room audio'}</small><span>{entry.text}</span></p>) : <p>Waiting for the conversation.</p>}</div>
  </section>;
}
