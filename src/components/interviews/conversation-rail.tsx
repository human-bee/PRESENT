'use client';

import { ArrowUpRight, Camera, ChevronDown, FileClock, MonitorUp, Sparkles } from 'lucide-react';
import type { BriefField, BriefSnapshot, InterviewEnvelope } from '@present/contracts/interviews';
import { nextInterviewPrompt } from '@/lib/interviews/guide';
import { EvidencePanel } from './evidence-panel';
import { StudioParticipants, StudioCallControls, type StudioCall } from './studio-call';
import type { useWorkboard } from './use-workboard';
import { evidenceFieldNames } from '@/lib/interviews/evidence';
import type { EvidenceSelection } from '@/lib/interviews/evidence';
import { LiveNotesControl } from './live-notes-control';

export function ConversationRail({ snapshot, interview, call, busy, selection, onEvidence, onConsent, onConversation, onFocus, onScreen, workboard }: {
  snapshot: BriefSnapshot; interview: InterviewEnvelope; call: StudioCall; busy: boolean; selection?: EvidenceSelection;
  onEvidence: () => void; onConsent: (enabled: boolean) => void; onConversation: () => void; onFocus: (field: BriefField) => void;
  onScreen: () => void; workboard: ReturnType<typeof useWorkboard>;
}) {
  const coach = nextInterviewPrompt(snapshot); const update = interview.latestUpdate;
  const pending = snapshot.suggestions.filter((item) => item.status === 'pending').length;
  return <aside className="ob-call-rail st-widget-rail" aria-label="Interview widgets">
    <div className="st-compact-call"><StudioParticipants snapshot={snapshot} interview={interview} call={call} /><StudioCallControls call={call} /></div>
    <section className="st-widget st-latest-update"><h2><FileClock />Latest update</h2>{update ? <><span className="st-widget-label">{evidenceFieldNames[update.field] || update.field}</span><p className="st-update-copy">{update.text || 'Cleared this answer.'}</p><div className="st-update-meta"><span>{update.actor === 'agent' ? 'Live notes' : 'Shared edit'} · {new Date(update.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button aria-label="View latest document change" onClick={() => onFocus(update.field)}><ArrowUpRight /></button></div></> : <p className="st-widget-muted">The next shared document change will appear here.</p>}{pending > 0 && <button className="st-widget-link" onClick={onConversation}>{pending} {pending === 1 ? 'addition' : 'additions'} to review</button>}</section>
    <section className="st-widget st-coach"><h2><Sparkles />Question coach</h2><span className="st-widget-label">Next question</span><button className="st-next-question" onClick={() => onFocus(coach.field)}>{coach.question}</button><span className="st-widget-label">Follow-ups</span>{coach.followUps.map((question) => <button key={question} className="st-follow-up" onClick={() => onFocus(coach.field)}><ArrowUpRight />{question}</button>)}</section>
    <details className="st-widget st-evidence-widget"><summary>Evidence <span>{Object.values(snapshot.sources).flat().length} items <ChevronDown /></span></summary><EvidencePanel key={`${selection?.field}:${selection?.text}`} snapshot={snapshot} selection={selection} onExpand={onEvidence} /></details>
    <section className="st-widget st-workboard"><h2><MonitorUp />Workboard</h2><div className="st-workboard-actions"><button className="ob-button" onClick={onScreen}><MonitorUp />{workboard.sharing ? 'Stop sharing' : 'Show screen'}</button><button className="ob-button" disabled={!workboard.stream || workboard.capturing} onClick={() => void workboard.capture()}><Camera />{workboard.capturing ? 'Saving…' : 'Capture frame'}</button></div></section>
    <LiveNotesControl interview={interview} busy={busy} onConsent={onConsent} />
  </aside>;
}
