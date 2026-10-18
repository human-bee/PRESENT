'use client';

import { useState } from 'react';
import { Check, Download } from 'lucide-react';
import type { BriefSnapshot, InterviewEnvelope } from '@present/contracts/interviews';
import type { InterviewAsset } from '@present/contracts/interview-studio';
import { BriefDialog } from './brief-dialog';
import { BriefPreview } from './brief-document';

export function ReviewDialog({ snapshot, interview, error, saving, onApprove, onExport, onEvidenceExport, onClose, onAsset }: {
  snapshot: BriefSnapshot; interview: InterviewEnvelope; error: string; saving: boolean;
  onApprove: () => Promise<void>; onExport: () => Promise<void>; onEvidenceExport: () => Promise<void>; onClose: () => void;
  onAsset?: (asset: InterviewAsset) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = snapshot.suggestions.filter((item) => item.status === 'pending').length;
  const approved = interview.approvals[interview.role] === interview.revision;
  const ready = interview.approvals.candidate === interview.revision && interview.approvals.recruiter === interview.revision;
  async function run(action: () => Promise<void>) { setBusy(true); try { await action(); } catch { /* Workspace banner reports failures. */ } finally { setBusy(false); } }
  return <BriefDialog title="The hiring-manager handoff" onClose={onClose} wide>
    <p className="ob-muted">This is the shared brief. Both of you review this version before it’s exported.</p>
    {error && <p role="alert" className="ob-error-inline">{error}</p>}
    {interview.example && <p className="ob-example-note">Example interview. All people and companies are fictional.</p>}
    {interview.replay && <p className="ob-example-note">{interview.replayMode === 'audio' ? 'QA audio replay. Check the test report for model results.' : 'QA transcript replay. Suggestions are scripted.'} Role approvals are simulated; the candidate has not reviewed this replay.</p>}
    <div className="ob-review-status">{(['candidate', 'recruiter'] as const).map((role) => <span key={role}>
      <span className={`ob-review-check ${interview.approvals[role] === interview.revision ? 'is-approved' : ''}`}><Check /></span>
      {role === 'candidate' ? 'Candidate' : 'Recruiter'} {interview.approvals[role] === interview.revision ? 'reviewed' : 'review pending'}
    </span>)}</div>
    {pending > 0 && <p className="ob-review-warning">Accept or dismiss {pending === 1 ? 'the remaining suggestion' : `the ${pending} remaining suggestions`} before approving.</p>}
    <BriefPreview snapshot={snapshot} onAsset={onAsset} />
    <footer className="ob-review-footer"><p>Any change to the brief reopens review.</p><div className="ob-inline-actions">
      <button className="ob-button" disabled={busy || saving || approved || pending > 0} onClick={() => void run(onApprove)}><Check />{approved ? 'You’ve reviewed this version' : 'I’ve reviewed this version'}</button>
      <button className="ob-button ob-button-primary" disabled={busy || saving || !ready || pending > 0} onClick={() => void run(onExport)}><Download />Export brief</button>
      <button className="ob-text-button" disabled={busy || saving || !ready || pending > 0} onClick={() => void run(onEvidenceExport)}>Download evidence</button>
    </div></footer>
  </BriefDialog>;
}
