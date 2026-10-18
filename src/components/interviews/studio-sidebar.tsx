'use client';

import { Activity, BookOpen, CircleHelp, FileText, Link, MessageSquareText, Plus, ScanLine, Sparkles, UserRound, ArrowUpRight } from 'lucide-react';
import type { BriefField, BriefSnapshot } from '@present/contracts/interviews';
import type { InterviewAsset } from '@present/contracts/interview-studio';
import { guideState, interviewGuide } from '@/lib/interviews/guide';

export type StudioPanel = 'scene' | 'research' | 'conversation' | 'activity';
const guideIcons = [UserRound, FileText, Sparkles, ArrowUpRight, CircleHelp, MessageSquareText];
export function StudioSidebar({ snapshot, panel, onFocus, onPanel, onAdd, onAsset, onInspector, onNew }: {
  snapshot: BriefSnapshot; panel: StudioPanel; onFocus: (field: BriefField) => void; onPanel: (panel: StudioPanel) => void;
  onAdd: () => void; onAsset: (asset: InterviewAsset) => void; onInspector: () => void; onNew: () => void;
}) {
  return <aside className="st-sidebar" aria-label="Interview guide and materials" data-widget="guide">
    <section><h2>Interview guide</h2><nav aria-label="Interview guide">{interviewGuide.map((item,index) => {
      const Icon = guideIcons[index]; const state = guideState(snapshot, item.field);
      return <button key={item.field} aria-label={item.label} aria-description={state} className={panel === 'scene' && snapshot.studio.focus === item.field ? 'is-active' : ''} aria-current={panel === 'scene' && snapshot.studio.focus === item.field ? 'step' : undefined} onClick={() => onFocus(item.field)}>
        <Icon /><span>{item.label}</span><i className={`st-guide-dot ${state}`} title={state} aria-hidden="true" />
      </button>;
    })}</nav></section>
    <section className="st-resource-list"><h2>Resources</h2>{snapshot.studio.assets.filter((item) => item.kind !== 'note' && item.kind !== 'workboard').map((item) => <button key={item.id} onClick={() => onAsset(item)}>{item.fileId ? <FileText /> : <Link />}<span>{item.title}</span></button>)}
      {snapshot.studio.assets.length === 0 && <p>Bring a résumé, profile, or something you built.</p>}
      <button onClick={onAdd}><Plus /><span>Add material</span></button>
    </section>
    <nav className="st-utilities" aria-label="Interview tools"><button className={panel === 'research' ? 'is-active' : ''} onClick={() => onPanel('research')}><BookOpen />Research & context</button><button className={panel === 'conversation' ? 'is-active' : ''} onClick={() => onPanel('conversation')}><MessageSquareText />Conversation notes</button><button className={panel === 'activity' ? 'is-active' : ''} onClick={() => onPanel('activity')}><Activity />Activity</button><button onClick={onInspector}><ScanLine />Session inspector</button></nav>
    <button className="st-new-brief" onClick={onNew}><Plus />New brief</button>
  </aside>;
}
