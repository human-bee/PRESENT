'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Camera, Focus, GripVertical, Maximize, Minus, MonitorUp, MoreHorizontal, Plus, StickyNote } from 'lucide-react';
import type { BriefField, BriefSnapshot } from '@present/contracts/interviews';
import type { InterviewAsset } from '@present/contracts/interview-studio';
import { buildEvidenceGraph } from '@/lib/interviews/evidence';
import { BriefDocument } from './brief-document';
import { MaterialPreview } from './material-preview';
import { EvidenceGraphView } from './evidence-graph';
import type { useWorkboard } from './use-workboard';

function BoardMaterial({ asset, zoom, onMove, onOpen, onInclude }: { asset: InterviewAsset; zoom: number; onMove: (id: string,x: number,y: number) => void; onOpen: () => void; onInclude: (included: boolean) => void }) {
  const [position, setPosition] = useState<{ x: number; y: number }>(); const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const left = position?.x ?? asset.x, top = position?.y ?? asset.y;
  return <article className={`st-board-tile ${asset.kind === 'note' || asset.kind === 'workboard' ? 'is-note' : ''}`} style={{ left, top }} data-asset-id={asset.id}>
    <div className="st-board-drag"><button className="st-drag-handle" type="button" aria-label={`Move ${asset.title}`} onPointerDown={(event) => { event.stopPropagation(); drag.current = { x: event.clientX, y: event.clientY, left: asset.x, top: asset.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (drag.current) setPosition({ x: Math.max(10,Math.min(4800,drag.current.left + (event.clientX - drag.current.x) / zoom)), y: Math.max(20,Math.min(4800,drag.current.top + (event.clientY - drag.current.y) / zoom)) }); }} onPointerUp={() => { if (position) onMove(asset.id,position.x,position.y); drag.current = null; setPosition(undefined); }} onKeyDown={(event) => {
      const delta: Record<string,[number,number]> = { ArrowLeft: [-16,0], ArrowRight: [16,0], ArrowUp: [0,-16], ArrowDown: [0,16] };
      if (delta[event.key]) { event.preventDefault(); onMove(asset.id,Math.max(10,asset.x + delta[event.key][0]),Math.max(20,asset.y + delta[event.key][1])); }
    }}><GripVertical /><small>{asset.createdBy === 'candidate' ? 'Added by candidate' : 'Added by recruiter'}</small></button><button aria-label={`Edit ${asset.title}`} onClick={onOpen}><MoreHorizontal /></button></div>
    <MaterialPreview asset={asset} onOpen={onOpen} /><div className="st-board-asset-actions"><label><input type="checkbox" checked={asset.included} onChange={(event) => onInclude(event.target.checked)} />Include in brief</label><button className="st-widget-link" onClick={onOpen}>Open</button></div>
  </article>;
}
export function StudioCanvas({ snapshot, onEdit, onFocus, onAdd, onNote, onAsset, onMove, onInclude, onBrief, onEvidence, onScreen, workboard }: {
  snapshot: BriefSnapshot; onEdit: (field: BriefField,value: string) => void; onFocus: (field: BriefField) => void; onAdd: () => void; onNote: () => void;
  onAsset: (asset: InterviewAsset) => void; onMove: (id: string,x: number,y: number) => void; onInclude: (id: string,value: boolean) => void;
  onBrief: () => void; onEvidence: () => void; onScreen: () => void; workboard: ReturnType<typeof useWorkboard>;
}) {
  const viewport = useRef<HTMLDivElement>(null); const paper = useRef<HTMLDivElement>(null); const [zoom,setZoom] = useState(.8); const [height,setHeight] = useState(1800);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const fitBoard = useCallback(() => { setZoom(Math.min(.95,Math.max(.24,((viewport.current?.clientWidth || 1260) - 48) / 1510))); if (viewport.current) viewport.current.scrollTo(0,0); },[]);
  useLayoutEffect(() => { fitBoard(); const observer = new ResizeObserver(() => setHeight(Math.max(1800,(paper.current?.scrollHeight || 1600) + 180))); if (paper.current) observer.observe(paper.current); return () => observer.disconnect(); }, [fitBoard]);
  return <section className="st-canvas" data-widget="canvas"><div className="st-board-toolbar"><button onClick={onAdd}><Plus />Add material</button><button onClick={onNote}><StickyNote />Note</button><button onClick={onScreen}><MonitorUp />{workboard.sharing ? 'Stop sharing' : 'Show screen'}</button><span /><button onClick={fitBoard}><Maximize />Fit board</button><button onClick={onBrief}><Focus />Focus brief</button></div>
    <div className="st-board-viewport" ref={viewport} onPointerDown={(event) => { if ((event.target as Element).closest('.st-board-tile,.st-board-paper,.st-board-evidence,.st-board-screen')) return; pan.current = { x: event.clientX,y: event.clientY,left: event.currentTarget.scrollLeft,top: event.currentTarget.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (pan.current) { event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX; event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY; } }} onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }}>
      <div className="st-board-size" style={{ width: Math.max(1510,...snapshot.studio.assets.map((asset) => asset.x + 320)) * zoom,height: Math.max(height,...snapshot.studio.assets.map((asset) => asset.y + 400)) * zoom }}><div className="st-board-world" style={{ transform: `scale(${zoom})`,width: 1510,height }}>
        <div className="st-board-paper" ref={paper}><BriefDocument snapshot={snapshot} onEdit={onEdit} onFocus={onFocus} onAdd={onAdd} onAsset={onAsset} /></div>
        {snapshot.studio.assets.map((asset) => <BoardMaterial key={asset.id} asset={asset} zoom={zoom} onMove={onMove} onOpen={() => onAsset(asset)} onInclude={(value) => onInclude(asset.id,value)} />)}
        <div className="st-board-evidence" data-widget="evidence"><button onClick={onEvidence}>Evidence <span>Open</span></button><EvidenceGraphView graph={buildEvidenceGraph(snapshot)} onSelect={onEvidence} /></div>
        {workboard.stream && <div className="st-board-screen"><h2>{workboard.previewOnly ? 'Screen preview' : 'Shared screen'}</h2>{workboard.previewOnly && <p className="st-material-caption">Connect the call to share this view live. Captures are saved for both of you.</p>}<video ref={workboard.attach} autoPlay playsInline muted aria-label="Shared work screen" /><button className="ob-button" disabled={workboard.capturing} onClick={() => void workboard.capture()}><Camera />Capture frame</button></div>}
        {snapshot.studio.assets.length === 0 && <button className="st-board-empty" onClick={onAdd}><Plus /><strong>Bring your work into the conversation</strong><span>Add a résumé, a link, or a screenshot. Arrange it around the brief.</span></button>}
      </div></div>
    </div><div className="st-board-zoom"><button aria-label="Zoom out canvas" onClick={() => setZoom((value) => Math.max(.24,value - .1))}><Minus /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in canvas" onClick={() => setZoom((value) => Math.min(1.3,value + .1))}><Plus /></button></div>
  </section>;
}
