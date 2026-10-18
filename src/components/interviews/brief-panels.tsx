'use client';

import { useState } from 'react';
import { ArrowUpRight, Check, Plus, X } from 'lucide-react';
import type { BriefField, BriefSnapshot, BriefSuggestion, InterviewEnvelope, InterviewTranscript } from '@present/contracts/interviews';
import { Editable, sectionNames, SourceNote } from './brief-document';

export function ResearchPanel({ snapshot, onEdit }: { snapshot: BriefSnapshot; onEdit: (field: BriefField, value: string) => void }) {
  return <div className="ob-secondary-panel"><h1>Research & context</h1><p className="ob-muted">Bring your preparation into the conversation. Check the details together.</p>
    <section><h2>The role, honestly</h2><p className="ob-muted">Include the opportunity, constraints, unknowns, and what the hiring manager needs.</p>
      <Editable field="roleContext" value={snapshot.fields.roleContext} placeholder="Scope, team, expectations, compensation range, open questions…" onEdit={onEdit} /></section>
    <section><h2>Research to check together</h2><Editable field="research" value={snapshot.fields.research} placeholder="Paste your profile research here." onEdit={onEdit} />
      <SourceNote source={snapshot.sources.research} /></section>
    <section><h2>Questions to take forward</h2><Editable field="questions" value={snapshot.fields.questions} placeholder="What would each of you like the hiring manager to clarify?" onEdit={onEdit} /></section>
    <p className="ob-editor-note">Research is supplied by you. Open brief does not invent or automatically enrich a candidate’s profile.</p>
  </div>;
}

export function Suggestion({ suggestion, speaker, onDecision, busy = false }: {
  suggestion: BriefSuggestion; speaker?: string; onDecision: (id: string, decision: 'accepted' | 'dismissed') => void; busy?: boolean;
}) {
  return <div className="ob-suggestion"><div><strong>Add to {sectionNames[suggestion.field]}</strong><p>{suggestion.text}</p>
    <details className="ob-suggestion-evidence"><summary>Evidence{speaker ? ` · ${speaker}` : ''}</summary><blockquote>“{suggestion.quote}”</blockquote></details></div>
    <button disabled={busy} className="ob-icon-button" aria-label={`Accept suggestion: ${suggestion.text}`} onClick={() => onDecision(suggestion.id, 'accepted')}><Check /></button>
    <button disabled={busy} className="ob-icon-button" aria-label={`Dismiss suggestion: ${suggestion.text}`} onClick={() => onDecision(suggestion.id, 'dismissed')}><X /></button>
  </div>;
}

export function ConversationPanel({ snapshot, interview, onNote, onDecision, onSuggest, onQuote }: {
  snapshot: BriefSnapshot; interview: InterviewEnvelope; onNote: (text: string, speaker: string) => Promise<void>;
  onDecision: (id: string, decision: 'accepted' | 'dismissed') => void;
  onSuggest: (id: string) => Promise<void>; onQuote: (transcript: InterviewTranscript, field: BriefField) => void;
}) {
  const [text, setText] = useState('');
  const [speaker, setSpeaker] = useState(interview.role === 'candidate' ? snapshot.fields.name : 'Recruiter');
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<BriefField>('motivation');
  const pending = snapshot.suggestions.filter((item) => item.status === 'pending');
  return <div className="ob-secondary-panel"><h1>Conversation</h1><p className="ob-muted">A shared record of the details worth carrying forward.</p>
    <form className="ob-note-form" onSubmit={async (event) => {
      event.preventDefault(); if (!text.trim()) return; setSaving(true);
      try { await onNote(text.trim(), speaker); setText(''); } catch { /* The shared error banner shows the failure. */ } finally { setSaving(false); }
    }}>
      <label>Speaker<input required maxLength={120} value={speaker} onChange={(event) => setSpeaker(event.target.value)} /></label>
      <label>Conversation note<textarea required maxLength={4000} rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder="A detail, a quote, a question worth keeping…" /></label>
      <button className="ob-button ob-button-primary" disabled={saving || !text.trim()}><Plus />{saving ? 'Adding…' : 'Add shared note'}</button>
    </form>
    {pending.length > 0 && <section><h2>Suggested additions</h2>{pending.map((item) => <div className="ob-conversation-suggestion" key={item.id}>
      <Suggestion suggestion={item} speaker={snapshot.transcripts.find((turn) => turn.id === item.transcriptId)?.speaker} onDecision={onDecision} />
    </div>)}</section>}
    <section><h2>Conversation notes</h2>
      <label className="ob-target">Add quotes to<select value={target} onChange={(event) => setTarget(event.target.value as BriefField)}>
        {Object.entries(sectionNames).map(([field, label]) => <option key={field} value={field}>{label}</option>)}
      </select></label>
      {snapshot.transcripts.length === 0 && <p className="ob-muted">Your shared notes will appear here. Live notes begin when both people opt in and the listening agent connects.</p>}
      {snapshot.transcripts.slice().reverse().map((item) => <article className="ob-transcript" key={item.id}>
        <p>“{item.text}”</p><span className="ob-source">{item.speaker} · {item.example ? 'Example quote' : 'Conversation note'}</span>
        <div className="ob-inline-actions"><button className="ob-button ob-button-small" onClick={() => onQuote(item, target)}><Plus />Add quote to brief</button>
          {interview.role === 'recruiter' && interview.agentAvailable && <button className="ob-text-button" onClick={() => { void onSuggest(item.id).catch(() => {}); }}>Suggest an addition <ArrowUpRight /></button>}
        </div>
      </article>)}
    </section>
  </div>;
}

export function ActivityPanel({ snapshot }: { snapshot: BriefSnapshot }) {
  return <div className="ob-secondary-panel"><h1>Activity</h1><p className="ob-muted">The work behind the story, visible to both of you.</p>
    <ol className="ob-activity">{snapshot.activity.map((item) => <li key={item.id}><span className="ob-activity-dot" />
      <p>{item.text}</p><time dateTime={new Date(item.timestamp).toISOString()}>{new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
    </li>)}</ol>
    <p className="ob-editor-note">Shared text edits save continuously. Activity records notes, suggestions, listening permissions, and handoff approvals.</p>
  </div>;
}
