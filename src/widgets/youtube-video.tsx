import { useEffect, useState, useRef } from 'react';
import { controlVideo, registerVideo } from './youtube-controls';
import type { RoomObject } from '../../shared/room';
import { readVideoReference, videoWrapperPath } from '../../shared/video-reference';

export function YouTubeVideo({ object, roomId }: { object: RoomObject; roomId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => registerVideo(object.id, () => frame.current), [object.id]);
  const reference = object.kind === 'widget' ? readVideoReference(object.data) : null;
  const source = reference ? videoWrapperPath(roomId, object.id) : null;
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry and reference changes must reinitialize the same wrapper URL.
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading'); setPlayerError(null);
    async function prepare() {
      if (!source) return;
      for (let retry = 0; retry < 4; retry++) {
        try {
          const response = await fetch(source, { method: 'HEAD', signal: controller.signal });
          if (response.ok) { setStatus('ready'); return; }
          if (response.status !== 404 && response.status < 500) break;
        } catch { if (controller.signal.aborted) return; }
        await new Promise(resolve => setTimeout(resolve, 250 * (retry + 1)));
        if (controller.signal.aborted) return;
      }
      setStatus('error');
    }
    void prepare();
    return () => controller.abort();
  }, [source, reference?.videoId, reference?.startSeconds, attempt]);
  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await controlVideo({ id: object.id, command: 'status' }) as { ready?: boolean; error?: unknown };
      if (!cancelled && !result.ready) setPlayerError('YouTube has not loaded. Retry the player.');
    }, 10000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [status, object.id]);
  if (!source || !reference) return <p role="status">This YouTube reference is unavailable.</p>;
  if (status !== 'ready') return <div role="status" style={{ padding: 16 }}>
    {status === 'loading' ? 'Loading video…' : <>The video could not be loaded. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></>}
  </div>;
  return <div style={{ position: 'relative', width: '100%', height: '100%' }}><iframe ref={frame}
    key={`${reference.videoId}:${reference.startSeconds}:${attempt}`}
    title={object.title || 'YouTube video'}
    src={source}
    style={{ display: 'block', width: '100%', height: '100%', border: 0, background: '#111' }}
    loading="eager"
    sandbox="allow-scripts allow-same-origin allow-presentation"
    allow="fullscreen; encrypted-media; picture-in-picture; autoplay; camera 'none'; microphone 'none'; geolocation 'none'"
    allowFullScreen
    referrerPolicy="strict-origin-when-cross-origin"
  />{playerError && <div role="status" style={{ position: 'absolute', bottom: 8, left: 8, right: 8, padding: 8, background: '#fff', color: '#222' }}>{playerError} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}</div>;
}
