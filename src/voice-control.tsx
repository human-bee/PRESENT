import { MicrophonePicker } from './media/microphone-picker';
import type { AgentProvider, GenerationOptions } from '../shared/agent-models';
import { useState } from 'react';
import { Icon } from './icons';
import { useVoice } from './voice/use-voice';
import type { CanvasContextProvider } from '../shared/canvas-commands';

export function VoiceControl({ roomId, selfId, position, audioStreams, canvasContext, provider, generationOptions }: {
  roomId: string; selfId: string; position: () => { x: number; y: number }; audioStreams: MediaStream[];
  provider: AgentProvider; generationOptions: GenerationOptions;
  canvasContext?: CanvasContextProvider;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'ambient' | 'conversation'>('ambient');
  const voice = useVoice(roomId, { selfId, viewport: position(), audioStreams, mode, canvasContext, provider, generationOptions });
  const active = voice.status !== 'idle' && voice.status !== 'error';
  return <>
    <button type="button" className={`dock-button${active ? ' active' : ''}`} aria-label={active ? 'Stop listening' : 'Start listening'} aria-pressed={active} title={active ? 'Stop listening' : 'Let the agent listen'} onContextMenu={event => { event.preventDefault(); setOpen(true); }} disabled={!selfId} onClick={() => { if (active) void voice.stop(); else { setOpen(true); void voice.start(); } }}><Icon name="spark"/></button>
    {(active || voice.error) && <button type="button" className={`voice-caption${voice.error ? ' voice-error' : ''}`} aria-label="Show voice transcript" onClick={() => setOpen(!open)}><span className="status-dot on"/>{voice.error ? voice.error : voice.status === 'connecting' ? 'Joining the conversation…' : voice.status === 'thinking' ? 'Following your thought…' : 'Listening quietly'}<Icon name="eye" size={12}/></button>}
    {open && <aside className="popover voice-panel"><div className="popover-heading"><span className="popover-label">IN THE CONVERSATION</span><button type="button" aria-label="Close transcript" onClick={() => setOpen(false)}><Icon name="close" size={16}/></button></div><h2>Leave your hands free.</h2>
      <MicrophonePicker disabled={active}/><div className="voice-modes"><button type="button" className={mode === 'ambient' ? 'chosen' : ''} onClick={() => setMode('ambient')}>Listen quietly</button><button type="button" className={mode === 'conversation' ? 'chosen' : ''} onClick={() => setMode('conversation')}>Talk with me</button></div>
      <p className="voice-note">{mode === 'ambient' ? 'Ask to capture a thought, start a timer, or make something. The agent listens to you and the people in your call.' : 'You hear the agent here. Its canvas changes are shared with the room.'}</p>
      <div className="voice-transcript" aria-live="polite">{voice.transcript.length ? voice.transcript.map(item => <p key={item.id} className={item.role}><small>{item.role === 'assistant' ? 'PRESENT' : 'In the room'}</small>{item.text}</p>) : <p className="voice-empty">Words appear here as the conversation unfolds.</p>}</div>
      <small className="voice-provider">GPT-Live · your room model handles scenes</small>
    </aside>}
  </>;
}
