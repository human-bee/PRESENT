'use client';

import type { InterviewEnvelope } from '@present/contracts/interviews';

export function LiveNotesControl({ interview, busy, onConsent }: {
  interview: InterviewEnvelope; busy: boolean; onConsent: (enabled: boolean) => void;
}) {
  return <div className="st-notes-settings">
    <label className="ob-consent"><input type="checkbox" checked={interview.notesConsent[interview.role]} disabled={!interview.agentAvailable || busy} onChange={(event) => onConsent(event.target.checked)} />Let the agent draft shared notes</label>
    <p>Candidate: {interview.notesConsent.candidate ? 'enabled' : 'paused'} · Recruiter: {interview.notesConsent.recruiter ? 'enabled' : 'paused'}</p>
    {!interview.agentAvailable && <p>Live notes are not connected. You can write together and add conversation notes.</p>}
  </div>;
}
