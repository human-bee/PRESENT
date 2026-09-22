import { useEffect, useRef, useState } from 'react';
import { CAPABILITIES, type CapabilityKind } from '../shared/capabilities';
import { Icon, type IconName } from './icons';
import type { createStarter } from './widgets/presets';
import type { McpProfileSummary } from '../shared/mcp-app';

export type AddKind = Parameters<typeof createStarter>[0] | CapabilityKind;
const extras: [AddKind, IconName, string, string][] = [
  ['note', 'note', 'A thought', 'Native sticky note'], ['timer', 'timer', 'A moment', 'A shared timer'],
  ['teleprompter', 'eye', 'A voice', 'Find your flow'], ['poll', 'spark', 'A question', 'Vote together'],
  ['synth', 'sound', 'A sound', 'Play together'],
];
type McpPlacement = { roomId: string; actor: string; position: () => { x: number; y: number }; pageId?: () => string | undefined; onAdded: (id: string) => void };
function AddMcpApp({ placement }: { placement: McpPlacement }) {
  const [profiles, setProfiles] = useState<McpProfileSummary[]>([]), [profileId, setProfileId] = useState(''), [tool, setTool] = useState(''), [input, setInput] = useState('{}'), [error, setError] = useState(''), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/mcp/profiles', { signal: controller.signal }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Apps could not load.'); setProfiles(result.profiles); setProfileId(result.profiles[0]?.id ?? ''); setTool(result.profiles[0]?.tools[0] ?? ''); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function submit() {
    if (busy.current || !profileId || !tool) return;
    busy.current = true; setSaving(true); setError('');
    try {
      const toolInput: unknown = JSON.parse(input);
      if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) throw new Error('Tool input must be a JSON object.');
      const response = await fetch('/api/mcp/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: placement.roomId, actor: placement.actor, serverProfile: profileId, toolName: tool, toolInput, position: placement.position(), pageId: placement.pageId?.() }), signal: AbortSignal.timeout(15000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The app could not be added.'); placement.onAdded(result.objectId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The app could not be added.'); }
    finally { busy.current = false; setSaving(false); }
  }
  return <form aria-label="Add MCP App" style={{ display: 'grid', gap: 7, padding: '8px 12px' }} onSubmit={event => { event.preventDefault(); void submit(); }}>
    {loading ? <small>Loading apps…</small> : !profiles.length ? <small>No apps are configured yet.</small> : <>
      <label>App<select aria-label="MCP app profile" value={profileId} onChange={event => { const profile = profiles.find(item => item.id === event.target.value); setProfileId(profile?.id ?? ''); setTool(profile?.tools[0] ?? ''); }}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.title}</option>)}</select></label>
      <label>Tool<select aria-label="MCP app tool" value={tool} onChange={event => setTool(event.target.value)}>{profiles.find(profile => profile.id === profileId)?.tools.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>Tool input (JSON)<textarea aria-label="MCP tool input" rows={3} maxLength={12000} value={input} onChange={event => setInput(event.target.value)} style={{ width: '100%', fontFamily: 'monospace' }}/></label>
      <button type="submit" disabled={saving || !tool}>{saving ? 'Adding app…' : 'Add app'}</button>
    </>}
    {error && <small role="alert" style={{ color: '#9b493c' }}>{error}</small>}
  </form>;
}
export function AddMenu({ add, upload, video, work, mcp }: { add: (kind: AddKind) => void; upload: (files: File[]) => void; video: (url: string) => void; work: () => void; mcp?: McpPlacement }) {
  const [url, setUrl] = useState('');
  const [showApps, setShowApps] = useState(false);
  return <div className="popover add-menu overlay"><span className="popover-label">MAKE ROOM FOR SOMETHING</span>
    {extras.map(([kind, icon, title, sub]) => <button type="button" key={kind} onClick={() => add(kind)}><Icon name={icon}/><span>{title}<small>{sub}</small></span></button>)}
    {CAPABILITIES.map(capability => <button type="button" key={capability.kind} onClick={() => add(capability.kind)}><Icon name={capability.kind === 'cards' || capability.kind === 'dice' ? 'dice' : 'note'}/><span>{capability.title}<small>{capability.description}</small></span></button>)}
    <label className="asset-upload"><Icon name="plus"/> Image or video<input type="file" accept="image/*,video/*" multiple onChange={event => { upload(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }}/></label>
    <button type="button" onClick={work}><Icon name="spark"/><span>A commitment<small>Assign it, start work, keep the result</small></span></button>
    {mcp && <><button type="button" aria-expanded={showApps} onClick={() => setShowApps(!showApps)}><Icon name="spark"/><span>An app<small>Bring a connected tool into the room</small></span></button>{showApps && <AddMcpApp placement={mcp}/>}</>}
    <form className="video-link-entry" onSubmit={event => { event.preventDefault(); if (url.trim()) video(url); }}><input aria-label="YouTube link" value={url} onChange={event => setUrl(event.target.value)} placeholder="Paste a YouTube link…" maxLength={2048}/><button type="submit" disabled={!url.trim()}>Add video</button></form>
  </div>;
}
