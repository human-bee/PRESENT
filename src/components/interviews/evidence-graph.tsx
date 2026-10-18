'use client';

import { useMemo, useRef, useState } from 'react';
import type { EvidenceGraph, EvidenceNode } from '@/lib/interviews/evidence';

function coordinates(node: EvidenceNode, index: number) {
  let seed = 0;
  for (const letter of node.id) seed = (seed * 31 + letter.charCodeAt(0)) >>> 0;
  const angle = (seed % 628) / 100;
  const radius = node.kind === 'question' ? 115 : node.kind === 'section' ? 62 : 88;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * 0.62, z: Math.sin(index * 2.4) * 45 };
}

export function EvidenceGraphView({ graph, selectedId, onSelect, expanded = false }: {
  graph: EvidenceGraph; selectedId?: string; onSelect: (node: EvidenceNode) => void; expanded?: boolean;
}) {
  const [rotation, setRotation] = useState({ x: -0.16, y: 0.28 });
  const [hovered, setHovered] = useState('');
  const drag = useRef<{ x: number; y: number } | null>(null);
  const projected = useMemo(() => graph.nodes.map((node, index) => {
    const point = coordinates(node, index);
    const x = point.x * Math.cos(rotation.y) + point.z * Math.sin(rotation.y);
    const z = -point.x * Math.sin(rotation.y) + point.z * Math.cos(rotation.y);
    const y = point.y * Math.cos(rotation.x) - z * Math.sin(rotation.x);
    const depth = point.y * Math.sin(rotation.x) + z * Math.cos(rotation.x);
    const scale = 340 / (340 + depth);
    return { ...node, x: 180 + x * scale, y: 115 + y * scale, depth, scale };
  }), [graph.nodes, rotation]);
  const byId = new Map(projected.map((node) => [node.id, node]));
  const related = new Set([selectedId]);
  for (const edge of graph.edges) {
    if (edge.from === selectedId) related.add(edge.to);
    if (edge.to === selectedId) related.add(edge.from);
  }
  return <div className={`ob-evidence-map${expanded ? ' is-expanded' : ''}`}>
    <svg viewBox="0 0 360 230" aria-label="Evidence relationship graph. Drag to rotate; select a node to inspect its source."
      onPointerDown={(event) => {
        if ((event.target as Element).closest('[data-evidence-node]')) return;
        drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
        drag.current = { x: event.clientX, y: event.clientY };
        setRotation((value) => ({ x: value.x + dy * 0.008, y: value.y + dx * 0.008 }));
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <g className="ob-graph-edges">{graph.edges.map((edge) => {
        const from = byId.get(edge.from), to = byId.get(edge.to);
        return from && to ? <line key={`${edge.from}:${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
          className={selectedId === from.id || selectedId === to.id ? 'is-selected' : ''} /> : null;
      })}</g>
      {projected.slice().sort((a, b) => b.depth - a.depth).map((node) => {
        const selected = selectedId === node.id;
        const showLabel = selected || hovered === node.id || (node.kind === 'question' && related.has(node.id));
        return <g key={node.id} data-evidence-node={node.id} role="button" tabIndex={0}
          aria-label={`${node.kind}: ${node.label}${node.status ? ` · ${node.status}` : ''}`} aria-pressed={selected}
          className={`ob-graph-node ${node.kind} ${node.status || ''}${selected ? ' is-selected' : ''}${selectedId && !related.has(node.id) ? ' is-context' : ''}`}
          transform={`translate(${node.x},${node.y})`} onClick={() => onSelect(node)}
          onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered('')}
          onFocus={() => setHovered(node.id)} onBlur={() => setHovered('')}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node); } }}>
          {selected && <circle r={13 * node.scale} className="ob-node-halo" />}
          <circle r={(node.kind === 'section' ? 7 : 5) * node.scale} />
          {showLabel && <text x={node.x > 245 ? -10 : 10} y={4} textAnchor={node.x > 245 ? 'end' : 'start'}>{node.label.length > 24 ? `${node.label.slice(0,23)}…` : node.label}</text>}
        </g>;
      })}
    </svg>
    <div className="ob-graph-caption"><span>Relationships · drag to rotate</span><button onClick={() => setRotation({ x: -0.16, y: 0.28 })}>Reset view</button></div>
  </div>;
}
