import { useEffect, useState } from 'react';
import { Box, useValue, type Editor } from 'tldraw';
import type { SceneControl } from '../../shared/scenes';
import './scene-controls.css';
type Summary = { sources: { id: string; title: string; url: string }[]; id: string; pageId: string; title: string; explanation: string; epistemic: string; time: number; duration: number; playing: boolean; error: string; revision: string; revisions: number; beats: { at: number; label: string }[] };
export function SceneControls({ roomId, editor }: { roomId: string; editor: Editor | null }) {
  const [scenes, setScenes] = useState<Summary[]>([]);
  useEffect(() => {
    let gone = false, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const read = async () => {
      let delay = 1500;
      try {
        if (document.hidden) return;
        const r = await fetch(`/api/scenes?roomId=${roomId}`, { signal: controller.signal });
        if (!r.ok) return;
        const body = await r.json(), visible = body.scenes.filter((s: Summary) => s.pageId === editor?.getCurrentPageId());
        if (!gone) setScenes(visible);
        if (visible.some((s: Summary) => s.playing)) delay = 200;
      } catch { /* Room connection owns offline errors. */ }
      finally { if (!gone) timer = setTimeout(read, delay); }
    };
    void read(); return () => { gone = true; controller.abort(); clearTimeout(timer); };
  }, [roomId, editor]);
  if (!editor) return null;
  return <>{scenes.map(scene => <SceneTransport key={scene.id} scene={scene} roomId={roomId} editor={editor}/>)}</>;
}

function SceneTransport({ scene, roomId, editor }: { scene: Summary; roomId: string; editor: Editor }) {
  const [error, setError] = useState('');
  const anchor = useValue('scene control anchor', () => {
    if (editor.getCurrentPageId() !== scene.pageId) return null;
    const shapes = editor.getCurrentPageShapes().filter(shape => shape.meta.sceneId === scene.id);
    const bounds = shapes.flatMap(shape => { const box = editor.getShapePageBounds(shape); return box ? [box] : []; });
    if (!bounds.length) return null;
    const box = Box.Common(bounds), viewport = editor.getViewportScreenBounds();
    const point = editor.pageToScreen({ x: box.x + box.w / 2, y: box.y + box.h });
    const width = Math.min(620, Math.max(320, box.w * editor.getZoomLevel()));
    if (point.x + width / 2 < viewport.x || point.x - width / 2 > viewport.maxX || point.y < viewport.y || point.y > viewport.maxY) return null;
    return { left: point.x, top: point.y + 12, width };
  }, [editor, scene.id, scene.pageId]);
  if (!anchor) return null;
  const send = async (action: SceneControl['action'], time?: number) => {
    try { const r = await fetch('/api/scenes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId, control: { sceneId: scene.id, action, time } }) }); const v = await r.json(); if (!r.ok) throw new Error(v.error); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not control animation'); }
  };
  return <section className="scene-strip" style={anchor} aria-label={`${scene.title} playback`}>
    <div className="scene-transport"><button aria-label="Restart animation" onClick={() => void send('restart')}>↶</button><button aria-label={scene.playing ? 'Pause animation' : 'Play animation'} onClick={() => void send(scene.playing ? 'pause' : 'play')}>{scene.playing ? 'Ⅱ' : '▶'}</button>
    <span className="scene-name" title={scene.title}>{scene.title}</span>
    <input aria-label="Animation position" type="range" min="0" max={scene.duration} step=".1" value={scene.time} onChange={e => void send('seek', Number(e.target.value))}/><span>{scene.time.toFixed(1)}s</span>
    <details><summary aria-label="Scene details">ⓘ</summary><div><strong>{scene.epistemic === 'hypothesis' ? 'Hypothesis' : 'Illustrative reconstruction'} · revision {scene.revisions}</strong><p>{scene.explanation}</p>{scene.sources.map(s => <p key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></p>)}{scene.beats.map(b => <button key={b.at} onClick={() => void send('seek', b.at)}>{b.at}s · {b.label}</button>)}</div></details></div>
    {(error || scene.error) && <p role="status">{error || scene.error}</p>}
  </section>;
}
