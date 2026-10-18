'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function PdfPreview({ url, title, compact = false }: { url: string; title: string; compact?: boolean }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>(); const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true; let loading: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined;
    setError(''); setPdf(undefined); setPage(1); setReady(false);
    void import('pdfjs-dist').then((library) => {
      if (!active) return;
      library.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      loading = library.getDocument({ url });
      return loading.promise.then((document) => { if (active) setPdf(document); });
    }).catch(() => { if (active) setError('Preview unavailable. Save the original file to open it.'); });
    return () => { active = false; void loading?.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true; let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setReady(false);
    void pdf.getPage(page).then(async (source) => {
      if (!active || !canvas.current) return;
      const viewport = source.getViewport({ scale: (compact ? 240 : 760) / source.getViewport({ scale: 1 }).width });
      const element = canvas.current; element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height);
      render = source.render({ canvas: element, viewport }); await render.promise;
      if (active) setReady(true);
    }).catch(() => { if (active) setError('Preview unavailable. Save the original file to open it.'); });
    return () => { active = false; render?.cancel(); };
  }, [pdf, page, compact]);
  return <div className={`st-pdf-render ${compact ? 'is-compact' : ''}`} data-pdf-ready={ready}>
    {error ? <p role="status">{error}</p> : <>{!ready && <span role="status">Loading résumé…</span>}<div className="st-pdf-page"><canvas ref={canvas} aria-label={`${title} · page ${page}`} hidden={!ready} /></div>
      {!compact && pdf && <div className="st-pdf-controls"><button aria-label="Previous PDF page" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></button><span>Page {page} of {pdf.numPages}</span><button aria-label="Next PDF page" disabled={page >= pdf.numPages} onClick={() => setPage((value) => value + 1)}><ChevronRight /></button></div>}</>}
  </div>;
}
