import { useEffect, useRef, useState } from 'react';
import type { ObjectPatch, RoomObject } from '../../shared/room';
import { SandboxWidget } from './sandbox-widget';
import { changeTimer, formatRemaining, readTimer, remainingTime } from './timer';
import { localImageSource } from './image';
import { CanvasMediaView } from '../media/canvas-media';
import { WorkCard } from './work-card';
import { YouTubeVideo } from './youtube-video';
import { useWidgetRuntime } from '../tldraw/widget-runtime';
import { useEditor } from 'tldraw';
import { shapeIdForObject } from '../../shared/tldraw-adapter';
import { SharedCaptions } from './captions';
import { fitCanvas } from '../tldraw/focus';
import { McpApp } from './mcp-app';
import './widgets.css';

type Props = { object: RoomObject; patch: (value: ObjectPatch, requestId?: string) => unknown; participantId: string; increment: (key: string, by: number, requestId?: string) => unknown; receipts?: string[]; onInteract?: () => void };

function Note({ object, patch }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const newlyAdded = useRef(!object.data.text && Date.now() - object.createdAt < 2500);
  useEffect(() => { if (newlyAdded.current) input.current?.focus(); }, []);
  return <textarea ref={input} className="widget-note" aria-label="Note text" placeholder="A thought, before it disappears…" value={typeof object.data.text === 'string' ? object.data.text : ''} spellCheck onChange={event => patch({ data: { text: event.target.value } })} />;
}

function Timer({ object, patch }: Props) {
  const timer = readTimer(object.data);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (timer.endsAt === null) return;
    const interval = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (timer.endsAt !== null && next >= timer.endsAt) window.clearInterval(interval);
    }, 200);
    return () => window.clearInterval(interval);
  }, [timer.endsAt]);
  const remaining = remainingTime(timer, now);
  const running = timer.endsAt !== null && remaining > 0;
  return <div className="widget-timer">
    <div className="widget-timer-time" role="timer" aria-label={`${formatRemaining(remaining)} remaining`}>{formatRemaining(remaining)}</div>
    <div className="widget-timer-track"><div style={{ width: `${remaining / timer.durationMs * 100}%` }} /></div>
    <div className="widget-timer-actions">
      <button type="button" className="widget-primary" onClick={() => patch({ data: changeTimer(timer, running ? 'pause' : 'start', Date.now()) })}>{running ? 'Pause' : remaining === 0 ? 'Again' : 'Start'}</button>
      <button type="button" className="widget-quiet" onClick={() => patch({ data: changeTimer(timer, 'reset', Date.now()) })}>Reset</button>
      <select aria-label="Timer duration" value={timer.durationMs} onChange={event => { const durationMs = Number(event.target.value); patch({ data: { durationMs, remainingMs: durationMs, endsAt: null } }); }}>
        {[60_000, 300_000, 900_000, 1_500_000, ...([60_000, 300_000, 900_000, 1_500_000].includes(timer.durationMs) ? [] : [timer.durationMs])].map(ms => <option key={ms} value={ms}>{ms / 60_000} min</option>)}
      </select>
    </div>
  </div>;
}

function Ink({ object }: Props) {
  const raw = Array.isArray(object.data.points) ? object.data.points : [];
  const points = raw.flatMap(point => {
    if (Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(value => typeof value === 'number' && Number.isFinite(value))) return [`${point[0]},${point[1]}`];
    if (point && typeof point === 'object' && typeof point.x === 'number' && typeof point.y === 'number' && Number.isFinite(point.x) && Number.isFinite(point.y)) return [`${point.x},${point.y}`];
    return [];
  }).join(' ');
  return <svg className="widget-ink" viewBox={`0 0 ${object.w} ${object.h}`} aria-label="Canvas sketch"><polyline points={points} fill="none" stroke={typeof object.data.color === 'string' ? object.data.color : '#617956'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Image({ object }: Props) {
  const source = localImageSource(object.data.src);
  return source ? <img className="widget-image" src={source} alt={typeof object.data.alt === 'string' ? object.data.alt : object.title} draggable={false} /> : <p>Image unavailable.</p>;
}

export function WidgetContent(props: Props) {
  const runtime = useWidgetRuntime();
  const editor = useEditor();
  if (props.object.data.capability === 'participant' || props.object.data.capability === 'screen-share') return <CanvasMediaView object={props.object}/>;
  if (props.object.data.capability === 'youtube') return <YouTubeVideo object={props.object} roomId={runtime.roomId}/>;
  if (props.object.data.capability === 'captions') return <SharedCaptions/>;
  if (props.object.data.capability === 'mcp-app') return <McpApp roomId={runtime.roomId} object={props.object} selfId={props.participantId}/>;
  if (props.object.data.capability === 'work') return <WorkCard roomId={runtime.roomId} object={props.object} patch={props.patch} selfId={props.participantId} onOpenArtifact={id => fitCanvas(editor, [shapeIdForObject(id)])}/>;
  return <fieldset aria-label={props.object.title} className={`widget-content widget-content-${props.object.kind}`} onPointerDown={props.onInteract} onFocus={props.onInteract}>
    {props.object.kind === 'note' ? <Note {...props} /> : props.object.kind === 'timer' ? <Timer {...props} /> : props.object.kind === 'ink' ? <Ink {...props} /> : props.object.kind === 'image' ? <Image {...props} /> : <SandboxWidget {...props} />}
  </fieldset>;
}
