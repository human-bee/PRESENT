'use client';

import { useLayoutEffect, useRef } from 'react';
import type { BriefField, BriefSnapshot, BriefSource } from '@present/contracts/interviews';
import { guideFor } from '@/lib/interviews/guide';
import { MaterialPreview } from './material-preview';
import type { InterviewAsset } from '@present/contracts/interview-studio';

export const sectionNames: Partial<Record<BriefField, string>> = {
  location: 'Based in', experience: 'Experience', availability: 'Availability',
  aiWork: 'AI-assisted delivery', research: 'Profile research',
  story: 'The story so far', work: 'Work worth talking about', motivation: 'What comes next',
  compensation: 'Compensation', workplace: 'Location & working arrangements', timing: 'Timing', questions: 'Questions to take forward',
};

export function Editable({ field, value, placeholder, onEdit, className = '', single = false }: {
  field: BriefField; value: string; placeholder?: string; onEdit: (field: BriefField, value: string) => void;
  className?: string; single?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure after React commits a different textarea value.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => { element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`; };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) { width = element.clientWidth; resize(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  const label = sectionNames[field] || ({ name: 'Candidate name', title: 'Role title', company: 'Company', workTitle: 'Work headline', roleContext: 'Role context', location: 'Based in', experience: 'Experience', availability: 'Availability' } as Partial<Record<BriefField, string>>)[field] || field;
  if (single) return <input data-brief-field={field} className={`ob-edit ${className}`} aria-label={label} value={value} maxLength={20000}
    placeholder={placeholder || 'To discuss'} onChange={(event) => onEdit(field, event.target.value)} />;
  return <textarea data-brief-field={field} ref={ref} rows={1} className={`ob-edit ${className}`} aria-label={label} value={value} maxLength={20000}
    placeholder={placeholder || 'To discuss'} onChange={(event) => onEdit(field, event.target.value)} />;
}

export function SourceNote({ source }: { source?: BriefSource[] }) {
  return <>{source?.map((citation, index) => {
    const url = citation.url && /^https?:\/\//i.test(citation.url) ? citation.url : undefined;
    if (citation.quote) return <details className="ob-source" key={index}><summary>{citation.label}</summary><blockquote>“{citation.quote}”</blockquote></details>;
    return <div className="ob-source" key={index}>{url ? <a href={url} target="_blank" rel="noreferrer">{citation.label}</a> : citation.label}</div>;
  })}</>;
}

export function BriefDocument({ snapshot, onEdit, onFocus, onAdd, onAsset }: {
  snapshot: BriefSnapshot; onEdit: (field: BriefField, value: string) => void; onFocus?: (field: BriefField) => void;
  onAdd?: () => void; onAsset?: (asset: InterviewAsset) => void;
}) {
  return <BriefPaper snapshot={snapshot} onEdit={onEdit} onFocus={onFocus} onAdd={onAdd} onAsset={onAsset} />;
}

export function BriefPaper({ snapshot, onEdit, onFocus, onAdd, onAsset }: {
  snapshot: BriefSnapshot; onEdit?: (field: BriefField, value: string) => void; onFocus?: (field: BriefField) => void;
  onAdd?: () => void; onAsset?: (asset: InterviewAsset) => void;
}) {
  const { fields } = snapshot;
  const field = (name: BriefField, single = false, className = '', placeholder?: string) => onEdit
    ? <Editable field={name} value={fields[name]} onEdit={onEdit} single={single} className={className} placeholder={placeholder} />
    : <p data-brief-field={name} className={className}>{fields[name] || 'To discuss'}</p>;
  const focused = snapshot.studio.focus;
  const answer = (name: BriefField) => <div className={`st-answer ${fields[name] ? '' : 'is-empty'}`}>{field(name, false, '', guideFor(name).answer)}</div>;
  const prompt = (name: BriefField) => onEdit && (!fields[name] || focused === name) ? <p className="st-document-prompt">{guideFor(name).prompt}</p> : null;
  const sectionClass = (name: BriefField) => `ob-paper-section${onEdit && focused === name ? ' st-section-focused' : ''}`;
  const included = snapshot.studio.assets.filter((asset) => asset.included);
  const infrastructure = /infra/i.test(fields.title);
  return <article className="ob-brief-page">
    <div className="ob-letterhead"><div className="ob-letterhead-brand"><span className="ob-letterhead-logo"><img src="/interview-assets/ai-tinkerers.png" alt="AI Tinkerers" /></span><strong>TALENT</strong></div>
      <div>{field('company', true)}<span> | CANDIDATE BRIEF</span></div></div>
    <h1 className="ob-candidate-name">{field('name')}</h1><div className="ob-role-line">{field('title')}</div>
    <div className="ob-brief-intro"><aside className="ob-career-snapshot"><h2>Career snapshot</h2>
      <label><span>Based in</span>{field('location')}</label><label><span>Experience</span>{field('experience')}</label><label><span>Availability</span>{field('availability')}</label>
    </aside><section className="ob-summary" data-guide-field="story" onFocusCapture={() => onFocus?.('story')}><h2>Interview summary</h2>{prompt('story')}{answer('story')}</section></div>
    <section className={sectionClass('work')} data-guide-field="work" onFocusCapture={() => onFocus?.('work')}><h2>{infrastructure ? 'Infrastructure and engineering approach' : 'Engineering and delivery'}</h2>
      {prompt('work')}{field('workTitle', false, 'ob-work-title', 'Give this work a headline')}{answer('work')}
    </section>
    <section className={sectionClass('aiWork')} data-guide-field="aiWork" onFocusCapture={() => onFocus?.('aiWork')}><div className="st-section-heading"><h2>AI-assisted delivery</h2>{onAdd && <button className="st-inline-material" onClick={onAdd}>Add work sample</button>}</div>{prompt('aiWork')}{answer('aiWork')}</section>
    <section className={sectionClass('motivation')} data-guide-field="motivation" onFocusCapture={() => onFocus?.('motivation')}><h2>Interest and practical alignment</h2>{prompt('motivation')}{answer('motivation')}
      <div className="ob-practical-fields">{(['compensation', 'workplace', 'timing'] as const).map((name) => <label key={name} data-guide-field={name} onFocusCapture={(event) => { event.stopPropagation(); onFocus?.(name); }}><span>{{ compensation: 'Compensation', workplace: 'Working arrangements', timing: 'Timing' }[name]}</span>{field(name, false, '', { compensation: 'Range or target discussed…', workplace: 'Location and working arrangement…', timing: 'Availability and next step…' }[name])}</label>)}</div>
    </section>
    {fields.research && <section className="ob-paper-section"><h2>Profile research</h2>{field('research')}</section>}
    <section className={sectionClass('questions')} data-guide-field="questions" onFocusCapture={() => onFocus?.('questions')}><h2>Questions to take forward</h2>{prompt('questions')}{answer('questions')}</section>
    {included.length > 0 && <section className="ob-paper-section st-included-materials"><h2>Work samples & materials</h2>{included.map((asset) => <div key={asset.id}><MaterialPreview asset={asset} onOpen={() => onAsset?.(asset)} />{onAsset && <button className="st-widget-link" onClick={() => onAsset(asset)}>View material</button>}</div>)}</section>}
    <footer className="ob-paper-footer"><span>AI Tinkerers | {fields.company || 'Talent'} | {fields.name}</span><span>Shared candidate brief</span></footer>
  </article>;
}

export function BriefPreview({ snapshot, onAsset }: { snapshot: BriefSnapshot; onAsset?: (asset: InterviewAsset) => void }) {
  return <div className="ob-handoff-preview"><BriefPaper snapshot={snapshot} onAsset={onAsset} /></div>;
}
