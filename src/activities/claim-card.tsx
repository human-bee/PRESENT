import { useState } from 'react';
import type { Activity, ActivityCommand, Claim } from '../../shared/activity';
import type { Send } from './activity-api';
import { SideSelect } from './side-select';
import { Evidence } from './claim-evidence';
export function ClaimCard({ claim: c, activity: a, send }: { claim: Claim; activity: Activity; send: Send }) {
  const [editing, setEditing] = useState(false),
    [expanded, setExpanded] = useState(false);
  const working = ['pending', 'running'].includes(c.research.status);
  const speaker =
    a.seats.find((s) => s.actor === c.speakerId)?.name ?? (c.speakerId ? 'Participant' : 'Speaker unknown');
  return (
    <article className={`claim-card claim-${c.review}`} data-claim-id={c.id}>
      <div className="claim-meta">
        <span>
          {c.origin === 'model-suggestion' ? '✦ Suggested claim' : 'Captured claim'} · v{c.version}
        </span>
        <strong>{c.review}</strong>
      </div>
      <p className="claim-proposition">{c.text}</p>
      <small className="claim-speaker">
        {speaker}
        {c.utteranceId && ' · from the conversation'}
      </small>
      <footer>
        <button type="button" disabled={working} onClick={() => void send({ type: 'research', claimId: c.id })}>
          {working ? 'Finding sources…' : c.evidence ? 'Research again' : 'Check sources ↗'}
        </button>
        <button type="button" onClick={() => setEditing(!editing)}>
          Correct / discuss
        </button>
        {c.evidence && (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {c.evidence.sources.length} sources {expanded ? '−' : '+'}
          </button>
        )}
      </footer>
      {c.research.error && <p className="claim-error">{c.research.error}</p>}
      {editing && (
        <form
          className="claim-correction"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const action = String(data.get('action'));
            const reason = String(data.get('reason'));
            const command: ActivityCommand =
              action === 'correct'
                ? {
                    type: 'correct',
                    claimId: c.id,
                    text: String(data.get('text')),
                    sideId: String(data.get('side')) || null,
                    reason,
                  }
                : {
                    type: 'review',
                    claimId: c.id,
                    review: action as Claim['review'],
                    reason,
                  };
            void send(command).then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        >
          <label>
            Claim
            <textarea name="text" aria-label="Claim wording" defaultValue={c.text} maxLength={1500} required />
          </label>
          <SideSelect activity={a} name="side" defaultValue={c.sideId ?? ''} />
          <label>
            Action
            <select name="action">
              <option value="correct">Correct wording or side</option>
              <option value="disputed">Keep disputed</option>
              <option value="accepted">I accept this claim</option>
              <option value="withdrawn">Withdraw claim</option>
              <option value="open">Reopen question</option>
            </select>
          </label>
          <label>
            Reason
            <input name="reason" placeholder="What changed your thinking?" maxLength={300} required />
          </label>
          <button type="submit">Save correction</button>
          <small>Acceptance records a participant’s view, not independent verification.</small>
        </form>
      )}
      {c.evidence && !expanded && (
        <div className="claim-evidence-preview">
          <Evidence report={c.evidence} stale={c.evidence.question !== c.text} />
        </div>
      )}
      {expanded && c.evidence && <Evidence report={c.evidence} stale={c.evidence.question !== c.text} />}{' '}
      {c.corrections.length > 0 && (
        <details className="claim-history">
          <summary>{c.corrections.length} corrections / reflections</summary>
          {c.corrections.map((item) => (
            <p key={`${item.at}-${item.actor}-${item.reason}`}>
              <strong>{a.seats.find((s) => s.actor === item.actor)?.name ?? 'Participant'}</strong> · {item.reason}
              <small>Previously: {item.text}</small>
            </p>
          ))}
        </details>
      )}
    </article>
  );
}
