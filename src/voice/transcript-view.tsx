import { TLDOCUMENT_ID, useValue, type Editor } from 'tldraw';
import { readTranscriptWindow } from '../../shared/transcript';
import type { VoiceTranscript } from './realtime-events';
import { mergeVoiceTranscript } from './transcript-window';
import { useLayoutEffect, useRef, useState } from 'react';

/** Mounted only while open, subscribed to the document rather than moving shapes. */
export function VoiceTranscriptView({ editor, live }: { editor: Editor | null; live: VoiceTranscript[] }) {
  const scroll = useRef<HTMLDivElement>(null), following = useRef(true);
  const [paused, setPaused] = useState(false);
  const saved = useValue('voice transcript history', () => {
    const document = editor?.store.get(TLDOCUMENT_ID);
    return readTranscriptWindow(document ? [document] : []);
  }, [editor]);
  const entries = mergeVoiceTranscript(saved.entries, live);
  const latest = entries.at(-1);
  useLayoutEffect(() => { if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [latest?.id, latest?.text]);
  return <>
    {saved.omitted > 0 && <small className="voice-note">Recent conversation retained. {saved.omitted} older captions have been trimmed.</small>}
    <div ref={scroll} className="voice-transcript" aria-live="polite" onScroll={event => {
      const element = event.currentTarget;
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      setPaused(!following.current);
    }}>{entries.length ? entries.map(item => <p key={item.id} className={item.role}><small>{item.role === 'assistant' ? 'PRESENT' : 'In the room'}</small>{item.text}</p>) : <p className="voice-empty">Words appear here as the conversation unfolds.</p>}</div>
    {paused && <button type="button" className="voice-note" onClick={() => { following.current = true; setPaused(false); if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }}>Jump to latest caption</button>}
  </>;
}
