'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { ExternalLink, FileText, Image as ImageIcon, Link as LinkIcon, StickyNote } from 'lucide-react';
import type { InterviewAsset } from '@present/contracts/interview-studio';
import { PdfPreview } from './pdf-preview';

export const MaterialSession = createContext({ id: '', token: '' });
export function useMaterialUrl(asset: InterviewAsset) {
  const { id, token } = useContext(MaterialSession);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!asset.fileId || !id) return;
    const abort = new AbortController(); let local = '';
    fetch(`/api/interviews/${id}/assets/${asset.id}`, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal })
      .then(async (response) => { if (!response.ok) throw new Error('This material could not be loaded.'); return response.blob(); })
      .then((blob) => { if (!abort.signal.aborted) { local = URL.createObjectURL(blob); setUrl(local); } })
      .catch((failure) => { if (!abort.signal.aborted) setError(failure.message); });
    return () => { abort.abort(); if (local) URL.revokeObjectURL(local); };
  }, [asset.fileId, asset.id, id, token]);
  return { url: asset.fileId ? url : asset.url || '', error };
}
export function MaterialPreview({ asset, expanded = false, onOpen }: { asset: InterviewAsset; expanded?: boolean; onOpen?: () => void }) {
  const { url, error } = useMaterialUrl(asset);
  const Icon = asset.kind === 'resume' ? FileText : asset.kind === 'image' ? ImageIcon : ['note', 'workboard'].includes(asset.kind) ? StickyNote : LinkIcon;
  return <div className={`st-material-preview ${expanded ? 'is-expanded' : ''}`}>
    <div className="st-material-title"><Icon /><strong>{asset.title}</strong>{asset.url && <a href={asset.url} target="_blank" rel="noreferrer" aria-label={`Open ${asset.title}`}><ExternalLink /></a>}</div>
    {asset.kind === 'image' && url && <img src={url} alt={asset.caption || asset.title} />}
    {asset.kind === 'resume' && !expanded && <div className="st-pdf-preview">{url ? <PdfPreview url={url} title={asset.title} compact /> : <FileText />}<button className="st-widget-link" onClick={onOpen}>View résumé</button></div>}
    {asset.kind === 'resume' && expanded && url && <PdfPreview url={url} title={asset.title} />}
    {asset.url && <p className="st-material-url">{asset.url.replace(/^https?:\/\//, '')}</p>}
    {asset.text && <p className="st-material-text">{asset.text}</p>}
    {asset.caption && <p className="st-material-caption">{asset.caption}</p>}
    {error && <p role="alert">{error}</p>}
    {asset.fileId && !url && !error && <p className="st-material-caption">Loading material…</p>}
    {expanded && asset.fileId && url && <a className="ob-button" href={url} download={asset.title}>Save original file</a>}
  </div>;
}
