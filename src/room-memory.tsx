import { useState } from 'react';
import { useValue, type Editor } from 'tldraw';
import { readTranscriptWindow } from '../shared/transcript';
import type { RoomEvent } from '../shared/room';

export function RoomMemory({ editor, events }: { editor: Editor | null; events: RoomEvent[] }) {
  const [query, setQuery] = useState('');
  const transcript = useValue('room transcript', () => editor ? readTranscriptWindow(editor.store.allRecords()) : { entries: [], omitted: 0 }, [editor]);
  const entries = [
    ...events.map(event => ({ ...event, source: 'activity' })),
    ...transcript.entries.map(entry => ({ ...entry, actor: entry.role === 'assistant' ? 'PRESENT' : 'Room audio', source: 'caption' })),
  ].filter(entry => entry.text.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.at - a.at).slice(0, 80);
  return <aside className="popover memory-panel overlay" aria-label="Room memory"><span className="popover-label">WHAT HAPPENED HERE</span><h2>A little room memory.</h2>
    {transcript.omitted > 0 && <p><small>Recent captions retained. {transcript.omitted} older captions are no longer in this room.</small></p>}
    <input className="memory-search" aria-label="Search room memory" placeholder="Find a thought, decision or moment…" value={query} onChange={event => setQuery(event.target.value)}/>
    {entries.length ? entries.map(entry => <p key={`${entry.source}:${entry.id}`}><span>{entry.text}</span><small>{entry.actor} · {new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></p>) : <p>{query ? 'No matching room memory.' : 'The story starts with whatever you do next.'}</p>}
  </aside>;
}
