'use client';

import { useState } from 'react';
import { FileUp, Plus } from 'lucide-react';
import { BriefDialog } from './brief-dialog';
import type { InterviewAsset } from '@present/contracts/interview-studio';
import { MaterialPreview } from './material-preview';
import { sectionNames } from './brief-document';

export function AddMaterialDialog({ onClose, onFile, onLink, initial = 'link' }: {
  onClose: () => void; onFile: (file: File) => Promise<void>; initial?: 'link' | 'note';
  onLink: (asset: { kind: string; title: string; url?: string; text: string }) => Promise<void>;
}) {
  const [kind, setKind] = useState<string>(initial);
  const [title, setTitle] = useState(''); const [url, setUrl] = useState(''); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); onClose(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not add material.'); } finally { setBusy(false); } }
  return <BriefDialog title="Bring something into the conversation" onClose={onClose}>
    <p className="ob-muted">A résumé, a portfolio, something you built, or a thought to explore together.</p>
    <label className="st-upload"><FileUp /><span>Upload a résumé or screenshot</span><small>PDF, PNG, JPEG, or WebP · up to 8 MB</small><input aria-label="Upload interview material" type="file" accept=".pdf,image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void run(() => onFile(file)); }} /></label>
    <form className="ob-new-form" onSubmit={(event) => { event.preventDefault(); void run(() => onLink({ kind, title, ...(kind === 'note' ? {} : { url }), text })); }}>
      <label>Material type<select aria-label="Material type" value={kind} onChange={(event) => setKind(event.target.value)}><option value="link">Link</option><option value="linkedin">LinkedIn</option><option value="portfolio">Portfolio</option><option value="github">GitHub</option><option value="video">Video</option><option value="note">Note</option></select></label>
      <label>Title<input required value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} placeholder={kind === 'note' ? 'What should we remember?' : 'A name for this material'} /></label>
      {kind !== 'note' && <label>Link<input required type="url" value={url} maxLength={2000} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>}
      <label>{kind === 'note' ? 'Thoughts' : 'What should we look at?'}<textarea rows={3} value={text} maxLength={6000} onChange={(event) => setText(event.target.value)} /></label>
      {error && <p role="alert" className="ob-error-inline">{error}</p>}<button className="ob-button ob-button-primary" disabled={busy}><Plus />{busy ? 'Adding…' : 'Add material'}</button>
    </form>
  </BriefDialog>;
}
export function MaterialDetailDialog({ asset, onClose, onUpdate, onRemove }: {
  asset: InterviewAsset; onClose: () => void; onUpdate: (id: string, changes: Record<string, unknown>) => Promise<void>; onRemove: (id: string) => Promise<void>;
}) {
  const [caption, setCaption] = useState(asset.caption); const [text, setText] = useState(asset.text); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [included, setIncluded] = useState(asset.included); const [field, setField] = useState(asset.field);
  async function run(action: () => Promise<void>) { setBusy(true); try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not update material.'); } finally { setBusy(false); } }
  return <BriefDialog title={asset.title} onClose={onClose} wide><MaterialPreview asset={asset} expanded />
    <div className="ob-new-form"><label>Caption for the hiring manager<textarea rows={2} maxLength={800} value={caption} onChange={(event) => setCaption(event.target.value)} /></label>
      {['note', 'workboard'].includes(asset.kind) && <label>Shared note<textarea rows={4} value={text} maxLength={6000} onChange={(event) => setText(event.target.value)} /></label>}
      <label>Attach to<select aria-label="Material section" value={field} disabled={busy} onChange={(event) => setField(event.target.value as typeof field)}>{Object.entries(sectionNames).map(([field,label]) => <option key={field} value={field}>{label}</option>)}</select></label>
      <label className="ob-consent"><input type="checkbox" checked={included} disabled={busy} onChange={(event) => setIncluded(event.target.checked)} />Include in the client brief</label>
      {error && <p role="alert" className="ob-error-inline">{error}</p>}<div className="ob-inline-actions"><button className="ob-button ob-button-primary" disabled={busy} onClick={() => void run(async () => { await onUpdate(asset.id, { caption, text, field, included }); onClose(); })}>{busy ? 'Saving…' : 'Save material'}</button><button className="ob-text-button" disabled={busy} onClick={() => void run(async () => { await onRemove(asset.id); onClose(); })}>Remove material</button></div>
    </div></BriefDialog>;
}
