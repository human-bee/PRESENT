import { useEffect, useState } from 'react';
import type { RoomTemplate, TemplateInstallation, TemplateSummary } from '../../shared/room-template';
import './templates.css';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Template request failed.');
  return value as T;
}
export const templateClient = {
  list: () => request<TemplateSummary[]>('/api/templates'),
  save: (roomId: string, name: string) => request<{ id: string; template: RoomTemplate }>('/api/templates', { roomId, name }),
  instantiate: (id: string) => request<TemplateInstallation>(`/api/templates/${encodeURIComponent(id)}/instantiate`, {}),
};
export function TemplatePicker({ roomId, onInstalled }: { roomId: string; onInstalled: (roomId: string) => void }) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => { let active = true; templateClient.list().then(v => { if (active) setTemplates(v); }).catch(() => { if (active) setError('Could not load templates.'); }); return () => { active = false; }; }, []);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Template request failed.'); } finally { setBusy(false); } }
  return <section className="room-templates" aria-label="Room templates">
    <h2>A fresh room, a familiar layout</h2>
    <p>Reuse blank notes, timer durations and native diagrams. Text, votes, results, identities and custom widgets are excluded. Timers start paused.</p>
    <ul>{templates.map(t => <li key={t.id}><span>{t.name}<small>{t.objects} instruments · {t.omissions} resets or omissions</small></span><button disabled={busy} onClick={() => void run(async () => { const result = await templateClient.instantiate(t.id); onInstalled(result.roomId); })}>Use</button></li>)}</ul>
    <form onSubmit={e => { e.preventDefault(); void run(async () => {
      const saved = await templateClient.save(roomId, name);
      const counts = new Map<string, number>(); for (const n of saved.template.notices) counts.set(n.reason, (counts.get(n.reason) ?? 0) + 1);
      setMessage(`Saved. ${[...counts].map(([reason, count]) => `${count} ${reason.replaceAll('-', ' ')}`).join('; ')}.`);
      setTemplates(await templateClient.list()); setName('');
    }); }}><label>Reusable template name<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="My weekly layout" /></label><small>Choose a generic name: this name is saved as entered in the server’s template catalog.</small><button disabled={busy || !name.trim()}>Save this layout</button></form>
    <p role="status">{busy ? 'Working…' : message}</p>{error && <p role="alert">{error}</p>}
  </section>;
}
