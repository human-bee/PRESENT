import { SceneControls } from './scenes/scene-controls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { makeObject, type Operation } from '../shared/room';
import { Canvas, type Viewport } from './canvas';
import { getIndexAbove } from 'tldraw';
import { objectToShape, shapeIdForObject } from '../shared/tldraw-adapter';
import { createCanvasContext } from './tldraw/context';
import { AddMenu, type AddKind } from './add-menu';
import { createCapability } from './widgets/packs';
import { isCapabilityKind } from '../shared/capabilities';
import { CanvasMediaProvider } from './media/media-context';
import { makeMediaObject } from '../shared/media-reference';
import { makeVideoObject } from '../shared/video-reference';
import { getRoomId, useRoom } from './room-client';
import { Icon, type IconName } from './icons';
import { createStarter } from './widgets/presets';
import { providerSchema, generationOptionsSchema, agentNames, type AgentProvider, type GenerationOptions } from '../shared/agent-models';
import { controlNativeCanvas } from './tldraw/native-controls';
import { useWebMCP } from './webmcp';
import { useMedia } from './media/use-media';
import { RoomAudio } from './media/media-elements';
import { People } from './people';
import { Settings } from './settings';
import { VoiceControl } from './voice-control';
import { RoomMemory } from './room-memory';
import { fitCanvas, focusResult } from './tldraw/focus';

export function App() {
  const [roomId] = useState(getRoomId);
  const [name, setName] = useState(() => localStorage.getItem('present:name') || 'Guest');
  const room = useRoom(roomId, name);
  const canvasContext = useMemo(() => createCanvasContext(room.editor), [room.editor]);
  const media = useMedia(roomId, room.selfId, name);
  const viewport = room.viewport;
  const selected = room.selected[0] ?? null;
  const select = (id: string | null) => room.editor?.setSelectedShapes(id ? [shapeIdForObject(id)] : []);
  const setViewport = (v: Viewport) => room.editor?.setCamera({ x: v.x / v.zoom, y: v.y / v.zoom, z: v.zoom });
  const [panel, setPanel] = useState<'add' | 'settings' | 'history' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<AgentProvider>(() => { try { const saved = providerSchema.safeParse(localStorage.getItem('present:provider')); return saved.success && saved.data !== 'spark' ? saved.data : 'luna'; } catch { return 'luna'; } });
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>(() => { try { return generationOptionsSchema.parse(JSON.parse(localStorage.getItem('present:generation-options') ?? '{"reasoning":"low","fast":false}')); } catch { return { reasoning: 'low', fast: false }; } });
  useEffect(() => { try { localStorage.setItem('present:provider', provider); localStorage.setItem('present:generation-options', JSON.stringify(generationOptions)); } catch { /* Session-only if storage is blocked. */ } }, [provider, generationOptions]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [lastGeneration, setLastGeneration] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [capabilities, setCapabilities] = useState<Record<string, unknown>>({});
  useEffect(() => { fetch('/api/agents').then(r => r.json()).then(setCapabilities).catch(() => {}); }, []);
  useEffect(() => { localStorage.setItem('present:name', name); }, [name]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timeout); }, [toast]);
  const attempt = (op: Operation) => { void room.act(op).catch(error => setToast(error.message)); };
  const position = () => {
    const x = (innerWidth / 2 - viewport.x) / viewport.zoom - 180;
    const y = (innerHeight / 2 - viewport.y) / viewport.zoom - 155;
    const overlap = room.room.objects.filter(o => Math.abs(o.x - x) < 220 && Math.abs(o.y - y) < 180).length;
    return { x: x + overlap * 38, y: y + overlap * 35 };
  };
  function add(kind: AddKind) {
    const editor = room.editor;
    if (!editor) return;
    const object = isCapabilityKind(kind) ? createCapability(kind, room.selfId, position()) : createStarter(kind, room.selfId, position());
    const index = getIndexAbove(editor.getCurrentPageShapesSorted().at(-1)?.index);
    editor.markHistoryStoppingPoint(`Add ${kind}`);
    editor.createShape(objectToShape(object, { parentId: editor.getCurrentPageId(), index }));
    select(object.id); setPanel(null);
  }
  function focus(ids: string[] = []) {
    const editor = room.editor;
    if (!editor) return;
    const targets = ids.map(shapeIdForObject).filter(id => editor.getShape(id));
    fitCanvas(editor, targets);
  }
  const webmcp = useWebMCP({ room: room.room, participants: room.participants, selected, viewport, act: room.act, focus, editor: room.editor });
  async function generate(text: string) {
    if (!text.trim() || busy || !room.connected) return;
    setBusy(true); setPrompt(''); setPanel(null);
    try {
      const view = room.editor?.getViewportPageBounds();
      let nativeCatalog: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch('/api/agents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...generationOptions, nativeCatalog, roomId, pageId: room.editor?.getCurrentPageId(), viewport: view && { x: view.x, y: view.y, w: view.w, h: view.h }, prompt: text, provider, position: position(), selection: room.selected, actor: room.selfId }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The agent could not finish that. Try again.');
        if (result.nativeControl) {
          const outcome = await controlNativeCanvas(room.editor, result.nativeControl);
          if (result.nativeControl.command === 'discover') {
            if (attempt === 1) throw new Error('Native tools were discovered, but the agent did not select an action.');
            nativeCatalog = outcome; continue;
          }
        }
        const ids = result.objectIds ?? (result.objectId ? [result.objectId] : []);
        if (room.editor && ids.length) void focusResult(room.editor, ids.map(shapeIdForObject), result.kind !== 'scene');
        setLastGeneration(`${result.providerName || agentNames[result.provider as AgentProvider]} · ${(result.elapsedMs / 1000).toFixed(1)}s`);
        break;
      }
    } catch (error) { setToast(error instanceof Error ? error.message : 'Something went wrong.'); setPrompt(text); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!busy || !room.editor) return;
    let framed = false;
    const timer = setInterval(() => {
      const drafts = room.editor!.getCurrentPageShapes().filter(s => s.meta.sceneDraft);
      if (!framed && drafts.length >= 4) { fitCanvas(room.editor!, drafts.map(s => s.id), 220, false); framed = true; }
    }, 400);
    return () => clearInterval(timer);
  }, [busy, room.editor]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); input.current?.focus(); return; }
      if (event.key === 'Escape') { setPanel(null); input.current?.blur(); }
      if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"],iframe')) return;

    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  const toggle = (next: typeof panel) => setPanel(panel === next ? null : next);
  return <>
    <CanvasMediaProvider media={media}><Canvas sync={room.sync} roomId={roomId} selfId={room.selfId} onMount={room.setEditor} act={room.act} onError={setToast}>
      {!room.room.objects.length && <div className="welcome overlay"><div className="welcome-eyebrow"><span className="little-sun"/> A SHARED SPACE. AN OPEN POSSIBILITY.</div><h1>A room for<br/><em>anything.</em></h1><p>Come as you are. Bring your people.<br/>Let the room become what you need.</p><div className="invitations"><button type="button" onClick={() => add('note')}><Icon name="note" size={15}/> Leave a thought</button><button type="button" onClick={() => generate('Create a beautiful shared interactive constellation where each participant can name a star, with connections between them.')} disabled={busy || !room.connected}><Icon name="spark" size={15}/> Make something together</button></div><span className="empty-footnote">A meeting. A game. A thought that becomes something.</span></div>}
    </Canvas></CanvasMediaProvider>
    <header className="topbar overlay"><div className="brand"><img src="/mark.svg" alt=""/><span>present</span></div><span className="top-divider"/><input className="room-title" aria-label="Room name" defaultValue={room.room.title} key={`${roomId}-${room.room.title}`} onBlur={event => { const title = event.target.value.trim(); if (title && title !== room.room.title) attempt({ type: 'rename', title }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/><div className="room-status"><i className={room.connected ? 'online' : ''}/>{room.connected ? 'here, together' : 'connecting…'}</div><button type="button" className="invite" onClick={() => navigator.clipboard.writeText(location.href).then(() => setToast('Room link copied. Open it in another browser to join.')).catch(() => setToast(location.href))}><Icon name="plus" size={15}/> Invite</button></header>
    <SceneControls roomId={roomId} editor={room.editor}/>
    <People participants={room.participants} selfId={room.selfId} media={media} place={(id, name, kind) => attempt({ type: 'put', object: makeMediaObject(id, name, kind, room.selfId, position()) })}/><RoomAudio participants={media.participants}/>
    <div className="bottom-area overlay">

      <form className={`composer${busy ? ' thinking' : ''}`} onSubmit={event => { event.preventDefault(); void generate(prompt); }}>
        <span className="composer-orbit" aria-hidden="true"/><input ref={input} aria-label="Ask the room" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={selected ? 'Change this, or imagine something new…' : 'What do you want to make room for?'} autoComplete="off" maxLength={3000}/><button className="send" type="submit" aria-label="Create with agent" disabled={!prompt.trim() || busy || !room.connected}><Icon name="arrow" size={18}/></button>
      </form>
      {(busy || lastGeneration) && <div className={`agent-progress${busy ? ' working' : ''}`} aria-live="polite"><span className="mini-orbit"/>{busy ? 'Making room for your idea…' : lastGeneration}</div>}
      <nav className="dock" aria-label="Room controls"><DockButton icon="plus" label="Add to room" onClick={() => toggle('add')} active={panel === 'add'}/><span className="dock-divider"/><DockButton icon="mic" label={media.mic ? 'Turn microphone off' : 'Turn microphone on'} onClick={() => void media.toggleMic()} active={media.mic}/><DockButton icon="camera" label={media.camera ? 'Turn camera off' : 'Turn camera on'} onClick={() => void media.toggleCamera()} active={media.camera}/><DockButton icon="screen" label={media.screen ? 'Stop screen sharing' : 'Share screen'} onClick={() => void media.toggleScreen()} active={media.screen}/><span className="dock-divider"/><VoiceControl provider={provider} generationOptions={generationOptions} canvasContext={canvasContext} roomId={roomId} selfId={room.selfId} position={position} audioStreams={media.participants.filter(p => !p.isLocal).flatMap(p => [p.stream, p.screenStream].filter((s): s is MediaStream => Boolean(s)))}/><DockButton icon="history" label="Room memory" onClick={() => toggle('history')} active={panel === 'history'}/><DockButton icon="settings" label="Room settings" onClick={() => toggle('settings')} active={panel === 'settings'}/></nav>
    </div>
    <div className="canvas-navigation overlay"><button type="button" aria-label="Zoom out" onClick={() => setViewport({ ...viewport, zoom: Math.max(.2, viewport.zoom - .1) })}>−</button><span>{Math.round(viewport.zoom * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setViewport({ ...viewport, zoom: Math.min(2.5, viewport.zoom + .1) })}>+</button><button type="button" aria-label="Fit everything" title="Fit everything" onClick={() => focus()}><Icon name="fit" size={16}/></button></div>
    <span className="canvas-hint">draw a thought · space to wander</span>
    {panel === 'add' && <AddMenu mcp={{ roomId, actor: room.selfId, position, pageId: () => room.editor?.getCurrentPageId(), onAdded: id => { setPanel(null); if (room.editor) void focusResult(room.editor, [shapeIdForObject(id)]); } }} add={add} upload={files => { setPanel(null); void room.editor?.putExternalContent({ type: 'files', files, point: position() }).catch(error => setToast(error.message)); }} video={url => { try { attempt({ type: 'put', object: makeVideoObject(url, room.selfId, position()) }); setPanel(null); } catch (error) { setToast(error instanceof Error ? error.message : 'Use a valid video link.'); } }} work={() => { const object = makeObject('widget', room.selfId, position(), { capability: 'work', owner: name, prompt: '' }); object.title = 'Follow through'; object.w = 390; object.h = 390; attempt({ type: 'put', object }); setPanel(null); }}/>}
    {panel === 'settings' && <Settings editor={room.editor} onError={setToast} name={name} setName={setName} provider={provider} setProvider={setProvider} generationOptions={generationOptions} setGenerationOptions={setGenerationOptions} webmcp={webmcp} capabilities={capabilities} room={room.room} close={() => setPanel(null)}/>}
    {panel === 'history' && <RoomMemory editor={room.editor} events={room.room.events}/>}
    {(toast || media.error || room.error) && <div className="toast overlay" role="status">{toast || media.error || room.error}</div>}
  </>;
}
export function DockButton({ icon, label, onClick, active }: { icon: IconName; label: string; onClick: () => void; active?: boolean }) {
  return <button type="button" className={`dock-button${active ? ' active' : ''}`} aria-label={label} aria-pressed={Boolean(active)} title={label} onClick={onClick}><Icon name={icon}/></button>;
}
