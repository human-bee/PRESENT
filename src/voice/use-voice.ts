import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProvider, GenerationOptions } from '../../shared/agent-models';
import type { CanvasContextProvider } from '../../shared/canvas-commands';
import type { VoiceMode, VoiceStatus, VoiceTranscript } from './realtime-events';
import { createVoiceTransport } from './transport';
export type { VoiceMode, VoiceStatus, VoiceTranscript } from './realtime-events';
export { exportVoiceTiming } from './timing';
export type VoiceOptions = { provider?: AgentProvider; generationOptions?: GenerationOptions; selfId: string; viewport?: { x: number; y: number } | (() => { x: number; y: number } | undefined); audioStreams?: MediaStream[]; mode?: VoiceMode; capture?: 'personal' | 'shared'; name?: string; canvasContext?: CanvasContextProvider };

export function useVoice(roomId: string, { selfId, viewport, audioStreams = [], mode = 'ambient', capture = 'personal', name = 'Participant', canvasContext, provider = 'luna', generationOptions = {} }: VoiceOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<VoiceTranscript[]>([]);
  const latest = useRef({ viewport, audioStreams, mode, canvasContext, provider, generationOptions });
  latest.current = { viewport, audioStreams, mode, canvasContext, provider, generationOptions };
  const retiring = useRef<Promise<void>>(Promise.resolve());
  const transport = useMemo(() => {
    // Each identity has its own callback gate; cleanup of an old identity cannot
    // update the UI or dispose media belonging to a replacement.
    let visible = true;
    const voice = createVoiceTransport({ beforeConnect: () => retiring.current, roomId, selfId, capture, name,
      viewport: () => typeof latest.current.viewport === 'function' ? latest.current.viewport() : latest.current.viewport, streams: () => latest.current.audioStreams,
      mode: () => latest.current.mode, context: () => latest.current.canvasContext,
      generation: () => ({ provider: latest.current.provider, ...latest.current.generationOptions }),
      status: value => { if (visible) setStatus(value); }, error: value => { if (visible) setError(value); },
      record: (id, role, text, final) => {
        if (!visible) return;
        setTranscript(previous => {
          const existing = previous.find(item => item.id === id);
          const item = { id, role, text: final ? text : `${existing?.text ?? ''}${text}`, final };
          return (existing ? previous.map(entry => entry.id === id ? item : entry) : [...previous, item]).slice(-60);
        });
      },
    });
    return { ...voice, stop: () => (retiring.current = voice.stop()), dispose: () => (retiring.current = voice.dispose()), show: () => { visible = true; }, hide: () => { visible = false; } };
  }, [roomId, selfId, capture, name]);
  useEffect(() => {
    transport.show(); setStatus('idle'); setError(null); setTranscript([]);
    const leave = () => { void transport.dispose(); };
    window.addEventListener('pagehide', leave);
    return () => { transport.hide(); window.removeEventListener('pagehide', leave); void transport.dispose(); };
  }, [transport]);
  useEffect(() => { transport.updateInput(); }, [transport, audioStreams]);
  useEffect(() => { transport.updateMode(); }, [transport, mode]);
  return { status, error, start: transport.start, stop: transport.stop, transcript, mode };
}
