import { useWidgetRuntime } from '../tldraw/widget-runtime';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectPatch, RoomObject } from '../../shared/room';
import { buildSandboxDocument, isWidgetState, readWidgetIncrement, readWidgetPatch, readWidgetLink, readWidgetRequestId } from './sandbox';

const noReceipts: string[] = [];
export function SandboxWidget({ object, patch, participantId, increment, receipts = noReceipts }: { object: RoomObject; patch: (value: ObjectPatch, requestId?: string) => unknown; participantId: string; increment: (key: string, by: number, requestId?: string) => unknown; receipts?: string[] }) {
  const { roomId } = useWidgetRuntime();
  const frame = useRef<HTMLIFrameElement>(null);
  const [externalLink, setExternalLink] = useState<string | null>(null);
  const html = typeof object.data.html === 'string' ? object.data.html : '<p style="padding:24px">A little space for something new.</p>';
  const state = isWidgetState(object.data.state) ? object.data.state : {};
  const live = useRef({ state, receipts, patch, increment });
  live.current = { state, receipts, patch, increment };
  // The browsing context survives every state update and canvas gesture.
  const { channel, document } = useMemo(() => {
    const channel = crypto.randomUUID();
    return { channel, document: buildSandboxDocument(html, channel, live.current.state, participantId) };
  }, [html, participantId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const source = frame.current?.contentWindow ?? null;
      if (event.source === source && event.data?.channel === channel && event.data?.type === 'present:ready') {
        source?.postMessage({ type: 'present:state', channel, state: live.current.state, receipts: live.current.receipts }, '*');
      }
      if (event.source === source && event.data?.channel === channel && event.data?.type === 'present:rendered' && Array.isArray(event.data.receipts)) {
        const accepted = event.data.receipts.filter((id: unknown) => typeof id === 'string' && live.current.receipts.includes(id));
        frame.current?.setAttribute('data-present-rendered-receipts', JSON.stringify(accepted.slice(-500)));
      }
      const requestId = readWidgetRequestId(event, source, channel);
      if (requestId && event.data?.type === 'present:contribute' && object.data.capability === 'debate' && typeof event.data.text === 'string' && event.data.text.length <= 1200) {
        void fetch('/api/agents/contribute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, objectId: object.id, actor: participantId, requestId, text: event.data.text }) })
          .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Contribution could not be saved.'); source?.postMessage({ type: 'present:contribution-result', channel, ok: true }, '*'); })
          .catch(error => source?.postMessage({ type: 'present:contribution-result', channel, ok: false, error: error instanceof Error ? error.message : 'Try again.' }, '*'));
      }
      const reject = () => source?.postMessage({ type: 'present:rejected', channel, requestId }, '*');
      const update = readWidgetPatch(event, source, channel);
      if (update && requestId) {
        const nextState = { ...live.current.state, ...update };
        if (isWidgetState(nextState)) {
          void Promise.resolve().then(() => live.current.patch({ data: { state: update } }, requestId)).catch(reject);
        } else reject();
      }
      const addition = readWidgetIncrement(event, source, channel);
      if (addition && requestId) void Promise.resolve().then(() => live.current.increment(addition.key, addition.by, requestId)).catch(reject);
      const link = readWidgetLink(event, source, channel);
      if (link) {
        if (navigator.userActivation?.isActive) window.open(link, '_blank', 'noopener,noreferrer');
        else setExternalLink(link);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [channel, roomId, object.id, object.data.capability, participantId]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'present:state', channel, state, receipts }, '*');
  }, [state, receipts, channel]);

  return <><iframe ref={frame} className="widget-sandbox" title={object.title || 'Shared widget'} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" />
    {externalLink && <div className="widget-external-link"><a href={externalLink} target="_blank" rel="noopener noreferrer" onClick={() => setExternalLink(null)}>Open {new URL(externalLink).hostname} ↗</a><button type="button" aria-label="Dismiss source link" onClick={() => setExternalLink(null)}>×</button></div>}
  </>;
}
