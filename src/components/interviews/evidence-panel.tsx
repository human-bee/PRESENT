'use client';

import { useMemo, useState } from 'react';
import { Expand, Quote } from 'lucide-react';
import type { BriefSnapshot } from '@present/contracts/interviews';
import { buildEvidenceGraph, evidenceFieldNames, evidenceQuestions, questionStatus, selectEvidence, type EvidenceSelection, type EvidenceNode } from '@/lib/interviews/evidence';
import { EvidenceGraphView } from './evidence-graph';
import { MaterialPreview } from './material-preview';
import type { InterviewAsset } from '@present/contracts/interview-studio';

export function EvidencePanel({ snapshot, selection, onExpand, expanded = false, onMaterial }: {
  snapshot: BriefSnapshot; selection?: EvidenceSelection; onExpand?: () => void; expanded?: boolean;
  onMaterial?: (asset: InterviewAsset) => void;
}) {
  const graph = useMemo(() => buildEvidenceGraph(snapshot), [snapshot]);
  const matching = selectEvidence(graph.items, selection);
  const [selected, setSelected] = useState('');
  const question = evidenceQuestions.find((item) => `question-${item.id}` === selected);
  const material = graph.materials.find((asset) => `material-${asset.id}` === selected);
  const candidates = question ? graph.items.filter((item) => item.source.questionId === question.id) : matching.items;
  const item = (question ? candidates : graph.items).find((source) => source.id === selected) || candidates.at(-1);
  const selectedId = question || material ? selected : item?.id;
  function choose(node: EvidenceNode) {
    if (node.kind === 'section') {
      const source = graph.items.find((entry) => entry.field === node.field);
      setSelected(source?.id || node.id);
    } else setSelected(node.id);
  }
  return <section className={`ob-evidence${expanded ? ' is-expanded' : ''}`} aria-label="Evidence inspector" data-widget="evidence" data-selection-match={matching.match}>
    <div className="ob-evidence-heading"><h2>Evidence</h2>{onExpand && <button className="ob-button ob-button-small" onClick={onExpand}><Expand />Open evidence</button>}</div>
    <div className="ob-evidence-layout"><div><EvidenceGraphView graph={graph} selectedId={selectedId} onSelect={choose} expanded={expanded} />
      <p className="ob-graph-disclosure">Graph relationships, not embedding distances.</p>
      {expanded && <div className="ob-question-list">{evidenceQuestions.map((entry) => <button key={entry.id} className={selected === `question-${entry.id}` ? 'is-selected' : ''} onClick={() => setSelected(`question-${entry.id}`)}>
        <span>{entry.label}</span><span>{questionStatus(graph.items, entry.id)}</span>
      </button>)}</div>}
    </div><div className="ob-evidence-detail">
      {selection && !question && (!selected || matching.items.some((source) => source.id === selected)) && <div className="ob-selected-passage"><span>{evidenceFieldNames[selection.field] || selection.field}</span><p>{selection.text || 'Section sources'}</p>
        {matching.match === 'section' && selection.text && <small>Section sources shown. This wording has no exact claim match.</small>}</div>}
      {question && <div className="ob-evidence-question"><span>{questionStatus(graph.items, question.id)}</span><p>{question.question}</p></div>}
      {question && questionStatus(graph.items, question.id) === 'open' && <p className="ob-muted">No answer captured yet.</p>}
      {material ? <><MaterialPreview asset={material} onOpen={() => onMaterial?.(material)} />{onMaterial && <button className="ob-button" onClick={() => onMaterial(material)}>Open material</button>}<p className="ob-evidence-relation">Shared material · {material.included ? 'Included in the brief' : 'On the workboard'}. Captions are shared notes, not a verbatim audio citation.</p></> : item ? <><div className="ob-evidence-speaker"><Quote /><strong>{item.speaker}</strong></div>
        {item.source.quote ? <blockquote>{item.source.quote}</blockquote> : <p className="ob-muted">{item.source.kind === 'shared' ? 'Shared edit. No verbatim quote is attached to this edit.' : item.source.statement || item.source.label}</p>}
        {item.source.questionId && <p className="ob-evidence-relation">Supports: {evidenceQuestions.find((entry) => entry.id === item.source.questionId)?.label} · {item.source.answerStatus || 'open'}</p>}
        {item.source.url && /^https?:\/\//.test(item.source.url) && <a href={item.source.url} target="_blank" rel="noreferrer">Open source</a>}
        {expanded && item.transcriptText && <details><summary>Full stored turn</summary><p>{item.transcriptText}</p></details>}
      </> : <p className="ob-muted">{question ? 'No answer captured yet.' : 'Select a passage in the brief and choose Show evidence, or select a node.'}</p>}
      {expanded && candidates.length > 1 && <div className="ob-source-list">{candidates.map((entry) => <button key={entry.id} className={item?.id === entry.id ? 'is-selected' : ''} onClick={() => setSelected(entry.id)}>{entry.source.statement || entry.source.label}</button>)}</div>}
    </div></div>
  </section>;
}
