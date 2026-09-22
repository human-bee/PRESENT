import { useEffect, useState } from 'react';
import { TLDOCUMENT_ID, useEditor, useValue } from 'tldraw';

/** Diagnostics only: document observed plus two frames, not a compositor guarantee. */
export function RenderReceipts() {
  const editor = useEditor();
  const receipts = useValue('render receipts', () => {
    const doc = editor.store.get(TLDOCUMENT_ID);
    const meta = doc?.meta.present as { requests?: unknown } | undefined;
    return JSON.stringify(Array.isArray(meta?.requests) ? meta.requests.flatMap(pair => Array.isArray(pair) && typeof pair[0] === 'string' ? [pair[0]] : []) : []);
  }, [editor]);
  const [rendered, setRendered] = useState('[]');
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setRendered(receipts)); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [receipts]);
  return <output hidden data-canvas-rendered-receipts={rendered}/>;
}
