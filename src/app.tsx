import { useViewerControls } from './access/viewer';
import type { RoomGrant } from '../shared/room-access';
import { RoomPanel } from './access/room-panel';
import { SceneControls } from './scenes/scene-controls';
import { useEffect, useMemo, useRef, useState } from 'react';
import { makeObject, type Operation } from '../shared/room';
import { Canvas, type Viewport } from './canvas';
import { getIndexAbove } from 'tldraw';
import { objectToShape, shapeIdForObject } from '../shared/tldraw-adapter';
import { createCanvasContext } from './tldraw/context';
import type { CanvasStill } from '../shared/canvas-commands';
import { AddMenu, type AddKind } from './add-menu';
import { createCapability } from './widgets/packs';
import { isCapabilityKind } from '../shared/capabilities';
import { CanvasMediaProvider } from './media/media-context';
import { makeMediaObject } from '../shared/media-reference';
import { makeVideoObject } from '../shared/video-reference';
import { getRoomId, useRoom } from './room-client';
import { Icon, type IconName } from './icons';
import { createStarter } from './widgets/presets';
import { providerSchema, generationOptionsSchema, agentNames, readProviderPreference, providerUnavailableReason, type ProviderAvailability, type AgentProvider, type GenerationOptions } from '../shared/agent-models';
import { controlNativeCanvas } from './tldraw/native-controls';
import { useWebMCP } from './webmcp';
import { useMedia } from './media/use-media';
import { RoomAudio } from './media/media-elements';
import { People } from './people';
import { Settings } from './settings';
import { VoiceControl } from './voice-control';
import { RoomMemory } from './room-memory';
import { fitCanvas, focusResult } from './tldraw/focus';
import { ActivityController } from './activities/activity-stage';
import { savePendingGeneration, updatePendingGeneration, loadPendingGeneration, forgetPendingGeneration, type PendingGeneration } from './requests/pending-generation';
import { WIDGET_SHORTCUT_EVENT } from './widgets/sandbox';
import { findOpenPosition } from './tldraw/placement';
import { createPlanningReview, createPlanningObserver, readPlanningReceipt, savePlanningReceipt, type PlanningReceipt } from './onboarding/planning-review';

export function App({ accessGrant, onRoomOpen, onAccessLeave }: { accessGrant?: RoomGrant; onRoomOpen?: (id: string) => void | Promise<void>; onAccessLeave?: () => void } = {}) {
  const viewer = accessGrant?.role === 'viewer';
  useViewerControls(viewer);
  const [roomId] = useState(() => accessGrant?.roomId ?? getRoomId());
  const [name, setName] = useState(() => localStorage.getItem('present:name') || 'Guest');
  const room = useRoom(roomId, name, accessGrant);
  const canvasContext = useMemo(() => createCanvasContext(room.editor), [room.editor]);
  const media = useMedia(roomId, room.selfId, name);
  const viewport = room.viewport;
  const selected = room.selected[0] ?? null;
  const select = (id: string | null) => room.editor?.setSelectedShapes(id ? [shapeIdForObject(id)] : []);
  const setViewport = (v: Viewport) => room.editor?.setCamera({ x: v.x / v.zoom, y: v.y / v.zoom, z: v.zoom });
  const [panel, setPanel] = useState<'add' | 'settings' | 'history' | 'room' | 'voice' | 'planning' | null>(null);
  const [planningReceipt, setPlanningReceipt] = useState<PlanningReceipt | null>(() => readPlanningReceipt(roomId));
  const [observePlanning, setObservePlanning] = useState(() => Boolean(readPlanningReceipt(roomId)));
  const planningObserver = useRef<ReturnType<typeof createPlanningObserver> | null>(null);
  const [prompt, setPrompt] = useState('');
  const [capabilities, setCapabilities] = useState<Record<string, unknown>>({});
  const providerStorageKey = accessGrant ? 'present:invite-provider' : 'present:provider';
  const [providerPreference, setProvider] = useState<AgentProvider | undefined>(() => { try { return readProviderPreference(localStorage.getItem(providerStorageKey)); } catch { return undefined; } });
  const serverProvider = providerSchema.safeParse(capabilities.defaultProvider);
  // An explicit preference always wins. Only an unconfigured first visit uses the operator's transport choice.
  const provider = providerPreference ?? (serverProvider.success ? serverProvider.data : accessGrant ? 'cerebras' : 'sol');
  const providerProblem = providerUnavailableReason(provider, (capabilities.providers ?? []) as ProviderAvailability[]);
  const [generationOptions, setGenerationOptions] = useState<GenerationOptions>(() => { try { return generationOptionsSchema.parse(JSON.parse(localStorage.getItem('present:generation-options') ?? '{"reasoning":"low","fast":false}')); } catch { return { reasoning: 'low', fast: false }; } });
  useEffect(() => { try { if (providerPreference) localStorage.setItem(providerStorageKey, providerPreference); localStorage.setItem('present:generation-options', JSON.stringify(generationOptions)); } catch { /* Session-only if storage is blocked. */ } }, [providerStorageKey, providerPreference, generationOptions]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [lastGeneration, setLastGeneration] = useState('');
  const [pendingGeneration, setPendingGeneration] = useState<PendingGeneration | null>(null);
  const generationController = useRef<AbortController | null>(null);
  useEffect(() => () => generationController.current?.abort(), []);
  useEffect(() => {
    if (!room.selfId) return;
    const saved = loadPendingGeneration(roomId, room.selfId);
    setPendingGeneration(saved);
    if (saved) setPrompt(saved.prompt);
  }, [roomId, room.selfId]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { fetch('/api/agents').then(r => r.json()).then(setCapabilities).catch(() => {}); }, []);
  useEffect(() => { localStorage.setItem('present:name', name); }, [name]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 6500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    if (!observePlanning || !room.connected) return;
    planningObserver.current ??= createPlanningObserver(readPlanningReceipt(roomId));
    const receipt = planningObserver.current.observe(room.room.objects);
    try { savePlanningReceipt(roomId, receipt); setPlanningReceipt(receipt); }
    catch { setObservePlanning(false); planningObserver.current = null; setToast('Local observations could not be saved.'); }
  }, [observePlanning, room.connected, room.room.objects, roomId]);
  const attempt = (op: Operation) => { void room.act(op).catch(error => setToast(error.message)); };
  const position = (size = { w: 390, h: 390 }) => {
    const editor = room.editor, view = editor?.getViewportPageBounds();
    const x = (view ? view.x + view.w / 2 : (innerWidth / 2 - viewport.x) / viewport.zoom) - size.w / 2;
    const y = (view ? view.y + view.h / 2 : (innerHeight / 2 - viewport.y) / viewport.zoom) - size.h / 2;
    const occupied = editor?.getCurrentPageShapes().flatMap(shape => { const bounds = editor.getShapePageBounds(shape); return bounds ? [bounds] : []; }) ?? room.room.objects;
    return findOpenPosition({ x, y, w: size.w, h: size.h }, occupied);
  };
  function add(kind: AddKind) {
    const editor = room.editor;
    if (!editor || viewer) return;
    const object = isCapabilityKind(kind) ? createCapability(kind, room.selfId, { x: 0, y: 0 }) : createStarter(kind, room.selfId, { x: 0, y: 0 });
    Object.assign(object, position(object));
    const index = getIndexAbove(editor.getCurrentPageShapesSorted().at(-1)?.index);
    editor.markHistoryStoppingPoint(`Add ${kind}`);
    editor.createShape(objectToShape(object, { parentId: editor.getCurrentPageId(), index }));
    select(object.id); setPanel(null);
    // Instruments have different sizes. Frame the actual new shape above the
    // composer and dock so their controls cannot steal its first interactions.
    fitCanvas(editor, [shapeIdForObject(object.id)], 0);
  }
  function focus(ids: string[] = []) {
    const editor = room.editor;
    if (!editor) return;
    const targets = ids.map(shapeIdForObject).filter(id => editor.getShape(id));
    fitCanvas(editor, targets);
  }
  function openPlanningReview() {
    const editor = room.editor;
    if (!editor || viewer || !room.connected) return;
    let brief = room.room.objects.find(object => object.data.planningReview === true && object.data.capability === 'brief');
    if (!brief) {
      const objects = createPlanningReview(room.selfId, position({ w: 1032, h: 740 }));
      editor.markHistoryStoppingPoint('Start planning & review');
      let index = getIndexAbove(editor.getCurrentPageShapesSorted().at(-1)?.index);
      for (const object of objects) { editor.createShape(objectToShape(object, { parentId: editor.getCurrentPageId(), index })); index = getIndexAbove(index); }
      brief = objects[0];
    }
    select(brief.id); fitCanvas(editor, [shapeIdForObject(brief.id)], 0); setPanel('planning');
  }
  const webmcp = useWebMCP({ room: room.room, participants: room.participants, selected, viewport, act: room.act, focus, editor: room.editor });
  async function generate(text: string, mode: 'new' | 'recover' | 'continue' = 'new') {
    if (viewer || !text.trim() || busy || !room.connected) return;
    if (mode === 'new' && pendingGeneration) { setToast('Check the saved request before starting another one.'); return; }
    if (mode === 'continue' && !['failed', 'missing', 'interrupted'].includes(pendingGeneration?.outcome ?? '')) return;
    if (mode !== 'recover' && providerProblem) { setToast(providerProblem); return; }
    const controller = new AbortController(); generationController.current = controller;
    setBusy(true); setPrompt(''); setPanel(null);
    try {
      const view = room.editor?.getViewportPageBounds();
      let saved: PendingGeneration;
      if (mode === 'recover') {
        if (!pendingGeneration) return;
        saved = pendingGeneration;
      } else {
        const selection = [...room.selected], pageId = room.editor?.getCurrentPageId();
        const nativeSelected = room.editor?.getSelectedShapes().some(shape => shape.type !== 'present-widget');
        let still: CanvasStill | null | undefined;
        if (nativeSelected) {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          let rejectCapture: (reason: unknown) => void = () => {};
          const interrupted = new Promise<never>((_, reject) => { rejectCapture = reject; });
          const cancelCapture = () => rejectCapture(controller.signal.reason);
          controller.signal.addEventListener('abort', cancelCapture, { once: true });
          try { still = await Promise.race([canvasContext.capture?.('selection'), interrupted, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('The selected picture could not be captured in time. Try again.')), 6000); })]); }
          finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancelCapture); }
          if (!still || still.dataUrl.length > 1500000) throw new Error('The selected picture could not be captured within the image limit. Select a smaller area and try again.');
          if (pageId !== room.editor?.getCurrentPageId() || JSON.stringify(selection) !== JSON.stringify(room.editor?.getSelectedShapeIds().map(id => id.slice(6)))) throw new Error('Your selection changed during capture. Select it again.');
        }
        controller.signal.throwIfAborted();
        saved = savePendingGeneration({ ...generationOptions, roomId, pageId, viewport: view && { x: view.x, y: view.y, w: view.w, h: view.h }, prompt: text, provider, position: position(), selection, actor: room.selfId, ...(still ? { canvasImage: still.dataUrl, canvasImageCaption: still.caption } : {}) });
      }
      setPendingGeneration(saved);
      for (let attempt = saved.attempt; attempt < 2; attempt++) {
        const response = await fetch('/api/agents/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ ...saved.payload, requestId: `${saved.requestId}:${attempt}`, ...(mode === 'recover' ? { recoverOnly: true } : {}) }) });
        const result = await response.json();
        if (!response.ok) {
          if (mode === 'recover' && ['running', 'failed', 'missing', 'interrupted'].includes(result.requestState)) { saved = updatePendingGeneration({ ...saved, outcome: result.requestState }); setPendingGeneration(saved); }
          throw new Error(result.error || 'The agent could not finish that. Check the saved request.');
        }
        if (result.nativeControl) {
          if (result.replayed && result.nativeControl.command !== 'discover') {
            setToast('The earlier editor action was already returned. Check the canvas before repeating it.');
            break;
          }
          const outcome = await controlNativeCanvas(room.editor, result.nativeControl);
          if (result.nativeControl.command === 'discover') {
            if (attempt === 1) throw new Error('Native tools were discovered, but the agent did not select an action.');
            // Replay must never open the next paid planning turn. The original
            // caller stores that step before dispatch so reload can replay it.
            if (mode === 'recover') { saved = updatePendingGeneration({ ...saved, outcome: 'missing' }); setPendingGeneration(saved); setToast('Discovery was recovered. Start a new continuation to request an action.'); return; }
            saved = updatePendingGeneration({ ...saved, attempt: 1, payload: { ...saved.payload, nativeCatalog: outcome } }); setPendingGeneration(saved); continue;
          }
        }
        const ids = result.objectIds ?? (result.objectId ? [result.objectId] : []);
        if (room.editor && ids.length) void focusResult(room.editor, ids.map(shapeIdForObject), result.kind !== 'scene');
        setLastGeneration(result.replayed ? 'Recovered the previous result' : `${result.providerName || agentNames[result.provider as AgentProvider]} · ${(result.elapsedMs / 1000).toFixed(1)}s`);
        break;
      }
      forgetPendingGeneration(roomId, room.selfId); setPendingGeneration(null);
    } catch (error) { setToast(controller.signal.aborted ? 'Interrupted. Check the saved result before starting another request.' : error instanceof Error ? error.message : 'Something went wrong.'); setPrompt(text); }
    finally { generationController.current = null; setBusy(false); }
  }
  useEffect(() => {
    const editor = room.editor;
    if (!busy || !editor) return;
    let framed = false;
    const timer = setInterval(() => {
      const drafts = editor.getCurrentPageShapes().filter(s => s.meta.sceneDraft);
      if (!framed && drafts.length >= 4) { fitCanvas(editor, drafts.map(s => s.id), 220, false); framed = true; }
    }, 400);
    return () => clearInterval(timer);
  }, [busy, room.editor]);
  useEffect(() => {
    const shortcut = (command: unknown) => {
      if (command === 'composer') { setPanel(null); input.current?.focus(); }
      if (command === 'escape') { setPanel(null); input.current?.blur(); }
    };
    function key(event: KeyboardEvent) {
      if (event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopPropagation(); shortcut('composer'); }
      if (event.key === 'Escape') shortcut('escape');
    }
    const widgetKey = (event: Event) => {
      const command = (event as CustomEvent).detail;
      // Blurring an iframe alone can strand keyboard focus in its browsing context.
      if (command === 'escape') room.editor?.focus();
      shortcut(command);
    };
    window.addEventListener('keydown', key, true); window.addEventListener(WIDGET_SHORTCUT_EVENT, widgetKey);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener(WIDGET_SHORTCUT_EVENT, widgetKey); };
  }, [room.editor]);
  const toggle = (next: typeof panel) => setPanel(panel === next ? null : next);
  return <>
    {!viewer && <ActivityController editor={room.editor} roomId={roomId} selfId={room.selfId} name={name} connected={room.connected}/>}
    <CanvasMediaProvider media={media}><Canvas sync={room.sync} roomId={roomId} selfId={room.selfId} onMount={room.setEditor} act={room.actWidget} onError={setToast}>
      {!viewer && room.connected && room.editor && !room.room.objects.length && <div className="welcome overlay"><div className="welcome-eyebrow"><span className="little-sun"/> A SHARED SPACE. AN OPEN POSSIBILITY.</div><h1>A room for<br/><em>anything.</em></h1><p>Come as you are. Bring your people.<br/>Let the room become what you need.</p><div className="invitations" style={{ flexWrap: 'wrap' }}><button type="button" onClick={() => add('note')} style={{ minWidth: 155 }}><Icon name="note" size={15}/> Leave a thought</button><button type="button" onClick={() => generate('Create a beautiful shared interactive constellation where each participant can name a star, with connections between them.')} disabled={busy || !room.connected || !!providerProblem} style={{ minWidth: 155 }}><Icon name="spark" size={15}/> Make something together</button><button type="button" onClick={openPlanningReview} style={{ minWidth: 155 }}><Icon name="note" size={15}/> Plan and review</button></div><span className="empty-footnote">A meeting. A game. A thought that becomes something.</span></div>}
    </Canvas></CanvasMediaProvider>
    <header className="topbar overlay"><div className="brand"><img src="/mark.svg" alt=""/><span>present</span></div><span className="top-divider"/><input className="room-title" aria-label="Room name" readOnly={viewer} defaultValue={room.room.title} key={`${roomId}-${room.room.title}`} onBlur={event => { const title = event.target.value.trim(); if (title && title !== room.room.title) attempt({ type: 'rename', title }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/><div className="room-status"><i className={room.connected ? 'online' : ''}/>{room.connected ? 'here, together' : 'connecting…'}</div><button type="button" className="invite" onClick={() => toggle('room')}><Icon name="plus" size={15}/>{!accessGrant || accessGrant.role === 'owner' ? 'Invite' : 'Room'}</button></header>
    {!viewer && <SceneControls roomId={roomId} editor={room.editor}/>}
    <People participants={room.participants} selfId={room.selfId} media={media} place={(id, name, kind) => attempt({ type: 'put', object: makeMediaObject(id, name, kind, room.selfId, position()) })}/><RoomAudio participants={media.participants}/>
    {!viewer && <div className="bottom-area overlay">

      <form className={`composer${busy ? ' thinking' : ''}`} onSubmit={event => { event.preventDefault(); void generate(prompt); }}>
        <span className="composer-orbit" aria-hidden="true"/><input ref={input} aria-label="Ask the room" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={selected ? 'Change this, or imagine something new…' : 'What do you want to make room for?'} autoComplete="off" maxLength={3000}/><button className="send" type="submit" aria-label="Create with agent" disabled={!prompt.trim() || busy || !room.connected || !!providerProblem || !!pendingGeneration}><Icon name="arrow" size={18}/></button>
      </form>
      {(busy || lastGeneration) && <div className={`agent-progress${busy ? ' working' : ''}`} aria-live="polite"><span className="mini-orbit"/>{busy ? 'Making room for your idea…' : lastGeneration}{busy && <button type="button" onClick={() => generationController.current?.abort()}>Stop generation</button>}</div>}
      {!busy && providerProblem && <div className="agent-progress" role="status"><span>{providerProblem}</span><button type="button" onClick={() => setPanel('settings')}>Choose model</button></div>}
      {!busy && pendingGeneration && <div className="agent-progress request-recovery" role="status"><span>{pendingGeneration.outcome === 'running' ? 'The saved request is still running.' : pendingGeneration.outcome === 'interrupted' ? 'The earlier process ended. Inspect the room before starting a new continuation.' : 'An unfinished request is saved.'}</span><button type="button" disabled={!room.connected} onClick={() => void generate(pendingGeneration.prompt, 'recover')}>Recover result</button>{['failed', 'missing', 'interrupted'].includes(pendingGeneration.outcome) && <button type="button" disabled={!room.connected || !!providerProblem || !prompt.trim()} onClick={() => void generate(prompt, 'continue')}>Start a new continuation</button>}<button type="button" onClick={() => { forgetPendingGeneration(roomId, room.selfId); setPendingGeneration(null); }}>Dismiss</button></div>}
      <nav className="dock" aria-label="Room controls"><DockButton icon="plus" label="Add to room" onClick={() => toggle('add')} active={panel === 'add'}/><DockButton icon="note" label="Planning and review" onClick={() => toggle('planning')} active={panel === 'planning'}/><span className="dock-divider"/><DockButton icon="mic" label={media.mic ? 'Turn microphone off' : 'Turn microphone on'} onClick={() => void media.toggleMic()} active={media.mic}/><DockButton icon="camera" label={media.camera ? 'Turn camera off' : 'Turn camera on'} onClick={() => void media.toggleCamera()} active={media.camera}/><DockButton icon="screen" label={media.screen ? 'Stop screen sharing' : 'Share screen'} onClick={() => void media.toggleScreen()} active={media.screen}/><span className="dock-divider"/><VoiceControl editor={room.editor} open={panel === 'voice'} setOpen={open => setPanel(current => open ? 'voice' : current === 'voice' ? null : current)} provider={provider} generationOptions={generationOptions} canvasContext={canvasContext} roomId={roomId} selfId={room.selfId} position={position} audioStreams={media.participants.filter(p => !p.isLocal).flatMap(p => [p.stream, p.screenStream].filter((s): s is MediaStream => Boolean(s)))}/><DockButton icon="history" label="Room memory" onClick={() => toggle('history')} active={panel === 'history'}/><DockButton icon="settings" label="Room settings" onClick={() => toggle('settings')} active={panel === 'settings'}/></nav>
    </div>
    }
    {viewer && <div className="viewer-banner">View only · You can explore the canvas and listen <button type="button" onClick={() => void media.connect()} disabled={media.status === 'connected'}>Join call</button></div>}
    <div className="canvas-navigation overlay"><button type="button" aria-label="Zoom out" onClick={() => setViewport({ ...viewport, zoom: Math.max(.2, viewport.zoom - .1) })}>−</button><span>{Math.round(viewport.zoom * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setViewport({ ...viewport, zoom: Math.min(2.5, viewport.zoom + .1) })}>+</button><button type="button" aria-label="Fit everything" title="Fit everything" onClick={() => focus()}><Icon name="fit" size={16}/></button></div>
    <span className="canvas-hint">draw a thought · space to wander</span>
    {panel === 'planning' && <section className="popover overlay" aria-label="Planning and review" style={{ left: 20, bottom: 145, transform: 'none', width: 'min(320px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 225px)', overflowY: 'auto', padding: 18 }}><button type="button" aria-label="Close planning guide" onClick={() => setPanel(null)} style={{ float: 'right' }}>×</button><h3>Plan, then return to review</h3><p>Keep one outcome, a decision, and an action with an owner in the brief. Correct it together. Return to this same room to review progress.</p><p>You decide; invited editors can edit and viewers can read. The five-minute timer starts when you press Start. Agent work starts only when you ask.</p><button type="button" onClick={() => { openPlanningReview(); setPanel(null); }}>Open planning brief</button><label style={{ display: 'block', marginTop: 12 }}><input type="checkbox" checked={observePlanning} onChange={event => { if (event.target.checked) setObservePlanning(true); else { try { savePlanningReceipt(roomId, null); } catch { /* Still stop observation if storage becomes unavailable. */ } planningObserver.current = null; setPlanningReceipt(null); setObservePlanning(false); } }}/> Keep local review observations</label><small>Optional counts in this browser only. No text, names, recording or uploads. Turning this off clears the counts.</small>{observePlanning && planningReceipt && <output aria-label="Local review observations" style={{ display: 'block', marginTop: 10 }}>Joins {planningReceipt.joins} · returns/reloads {planningReceipt.returns} · briefs seen {planningReceipt.artifacts} · text corrections observed {planningReceipt.corrections} · actions marked Done {planningReceipt.reportedDone}</output>}<small style={{ display: 'block', marginTop: 8 }}>These are observed changes and reported progress, not proof of usefulness, completed work or retention.</small></section>}
    {panel === 'room' && <RoomPanel grant={accessGrant} roomId={roomId} close={() => setPanel(null)} onLeave={() => onAccessLeave?.()} onOpen={id => onRoomOpen ? onRoomOpen(id) : location.assign(`/r/${id}`)}/>}
    {panel === 'add' && <AddMenu mcp={{ roomId, actor: room.selfId, position, pageId: () => room.editor?.getCurrentPageId(), onAdded: id => { setPanel(null); if (room.editor) void focusResult(room.editor, [shapeIdForObject(id)]); } }} add={add} upload={files => { setPanel(null); void room.editor?.putExternalContent({ type: 'files', files, point: position() }).catch(error => setToast(error.message)); }} video={url => { try { attempt({ type: 'put', object: makeVideoObject(url, room.selfId, position()) }); setPanel(null); } catch (error) { setToast(error instanceof Error ? error.message : 'Use a valid video link.'); } }} work={() => { const object = makeObject('widget', room.selfId, position(), { capability: 'work', owner: name, prompt: '' }); object.title = 'Follow through'; object.w = 390; object.h = 390; attempt({ type: 'put', object }); setPanel(null); }}/>}
    {panel === 'settings' && <Settings editor={room.editor} onError={setToast} name={name} setName={setName} provider={provider} setProvider={setProvider} generationOptions={generationOptions} setGenerationOptions={setGenerationOptions} webmcp={webmcp} capabilities={capabilities} room={room.room} hosted={!!accessGrant} close={() => setPanel(null)}/>}
    {panel === 'history' && <RoomMemory editor={room.editor} events={room.room.events}/>}
    {(toast || media.error || room.error) && <div className="toast overlay" role="status">{toast || media.error || room.error}</div>}
  </>;
}
export function DockButton({ icon, label, onClick, active }: { icon: IconName; label: string; onClick: () => void; active?: boolean }) {
  return <button type="button" className={`dock-button${active ? ' active' : ''}`} aria-label={label} aria-pressed={Boolean(active)} title={label} onClick={onClick}><Icon name={icon}/></button>;
}
