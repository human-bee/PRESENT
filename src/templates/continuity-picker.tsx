import { useEffect, useState } from 'react';
import type { ContinuityItem, ContinuityPreview, ContinuityInstallation } from '../../shared/room-continuity';

async function request<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/templates/continuity/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Selected content could not be carried forward.');
  return value as T;
}
function destinationId(value: string) {
  if (!value.trim()) return undefined;
  const candidate = value.trim();
  if (/^[a-f0-9]{48}$/.test(candidate)) return candidate;
  const url = new URL(candidate);
  if (url.origin !== location.origin || !/^\/r\/[a-f0-9]{48}$/.test(url.pathname)) throw new Error('Use an exact room ID or a room link from this PRESENT server.');
  return url.pathname.slice(3);
}
export function ContinuityPicker({ roomId, onInstalled }: { roomId: string; onInstalled: (roomId: string) => void }) {
  const [signed, setSigned] = useState(false);
  useEffect(() => { let active = true; void fetch('/api/profile').then(response => response.json()).then(profile => { if (active) setSigned(profile.profile === 'invite'); }).catch(() => {}); return () => { active = false; }; }, []);
  const [items, setItems] = useState<ContinuityItem[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false), [omitted, setOmitted] = useState(0), [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setItems([]); setSelected([]); setLoaded(false); setDestination(''); setError(''); }, [roomId]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Continuity request failed.'); } finally { setBusy(false); } }
  function discard() { setItems([]); setSelected([]); setLoaded(false); setDestination(''); setError(''); }
  if (!signed) return null;
  return <section className="room-continuity" aria-label="Selected continuity">
    <h2>Carry only what matters</h2>
    <p>Review selected notes, decisions and plain Markdown source excerpts. Nothing is selected automatically. Ambient transcript and people metadata, permissions, work state and HTML widgets are excluded. Review the selected text for anything private.</p>
    <button type="button" disabled={busy} onClick={() => void run(async () => { const preview = await request<ContinuityPreview>('preview', { sourceRoomId: roomId }); setItems(preview.items); setSelected([]); setLoaded(true); setOmitted(preview.omitted); })}>{loaded ? 'Refresh carry-forward preview' : 'Preview selected continuity'}</button>
    {loaded && <>
      <p>{items.length} allowlisted text items available · {omitted} empty, oversized or unsupported objects omitted. Select up to ten and correct any text before copying.</p>
      {items.map((item, index) => <div key={item.sourceObjectId} className="continuity-item">
        <label><input type="checkbox" checked={selected.includes(item.sourceObjectId)} disabled={busy || (!selected.includes(item.sourceObjectId) && selected.length >= 10)} onChange={event => setSelected(current => event.target.checked ? [...current, item.sourceObjectId] : current.filter(id => id !== item.sourceObjectId))}/>{item.kind === 'markdown-artifact' ? 'Source excerpt' : 'Decision or note'} {index + 1}</label>
        <textarea aria-label={`Carry-forward text ${index + 1}`} value={item.text} maxLength={4000} disabled={busy} onChange={event => setItems(current => current.map(value => value.sourceObjectId === item.sourceObjectId ? { ...value, text: event.target.value } : value))}/>
        <small>Source object {item.sourceObjectId}. Editing this preview leaves the source unchanged.</small>
      </div>)}
      <label>Destination room ID or link<input value={destination} disabled={busy} placeholder="Leave blank to create a new room" onChange={event => setDestination(event.target.value)}/></label>
      <p>The destination must be a fresh unused room you can edit. Copied text gets new native IDs and source provenance. Work never starts or inherits an executor.</p>
      <button type="button" disabled={busy || selected.length === 0} onClick={() => void run(async () => {
        const selection = items.filter(item => selected.includes(item.sourceObjectId)).map(({ sourceObjectId, digest, text }) => ({ sourceObjectId, digest, text }));
        const result = await request<ContinuityInstallation>('apply', { sourceRoomId: roomId, selection, ...(destination.trim() ? { destinationRoomId: destinationId(destination) } : {}) }); onInstalled(result.roomId);
      })}>Carry {selected.length} selected items</button>
      <button type="button" disabled={busy} onClick={discard}>Discard carry-forward preview</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
