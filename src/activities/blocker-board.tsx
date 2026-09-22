import { useState } from 'react';
import type { Activity } from '../../shared/activity';
import type { Send } from './activity-api';
export function BlockerBoard({ activity: a, selfId, send }: { activity: Activity; selfId: string; send: Send }) {
  const [adding, setAdding] = useState(false),
    member = (id: string) =>
      a.seats.find((s) => s.actor === id)?.name ?? a.meeting.members.find((p) => p.actor === id)?.name ?? 'Teammate';
  return (
    <section className="blocker-board">
      <header>
        <h2>What’s in the way?</h2>
        <button type="button" onClick={() => setAdding(!adding)}>
          + Blocker
        </button>
      </header>
      {adding && (
        <form
          className="activity-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void send({ type: 'blocker', title: String(d.get('title')), ownerId: String(d.get('owner')) }).then(
              (ok) => {
                if (ok) setAdding(false);
              },
            );
          }}
        >
          <label>
            Blocker
            <input name="title" maxLength={180} required />
          </label>
          <label>
            Owner
            <select name="owner" defaultValue={selfId}>
              {a.seats.map((s) => (
                <option key={s.actor} value={s.actor}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Track blocker</button>
        </form>
      )}
      {a.meeting.blockers.map((b) => (
        <article className={`blocker-card blocker-${b.status}`} key={b.id}>
          <span>{b.status === 'resolved' ? '✓ Owner confirmed' : '○ Needs a next move'}</span>
          <h3>{b.title}</h3>
          <small>{member(b.ownerId)}</small>
          {b.resolution && (
            <blockquote>
              “{b.resolution.text}”
              <small>
                {member(b.resolution.actor)} ·{' '}
                {b.resolution.utteranceId ? 'from the conversation' : 'explicit confirmation'}
              </small>
            </blockquote>
          )}
          {b.status === 'open' && b.ownerId === selfId && (
            <details>
              <summary>Update this blocker</summary>
              <button
                type="button"
                onClick={() =>
                  void send({ type: 'resolve-blocker', blockerId: b.id, text: 'I confirm this blocker is resolved.' })
                }
              >
                Confirm resolved
              </button>
            </details>
          )}
        </article>
      ))}
      {!a.meeting.blockers.length && (
        <p className="meeting-empty">
          Name a blocker and who can resolve it. The room will follow the conversation from there.
        </p>
      )}
      {a.resolutionSuggestions
        .filter((s) => ['pending', 'checking', 'review', 'stale'].includes(s.status))
        .slice(-4)
        .map((s) => {
          const b = a.meeting.blockers.find((b) => b.id === s.blockerId);
          return (
            <aside key={s.id} className="resolution-suggestion">
              <span>
                {s.status === 'checking' || s.status === 'pending' ? '✦ Checking the meaning' : 'A quick check'}
              </span>
              <h4>{b?.title}</h4>
              <q>{s.source.quote}</q>
              <p>{s.reason}</p>
              {s.status === 'review' && b?.ownerId === selfId && (
                <div>
                  <button
                    type="button"
                    onClick={() => void send({ type: 'resolution-review', suggestionId: s.id, accept: true })}
                  >
                    Yes, my blocker is resolved
                  </button>
                  <button
                    type="button"
                    onClick={() => void send({ type: 'resolution-review', suggestionId: s.id, accept: false })}
                  >
                    Keep it open
                  </button>
                </div>
              )}
            </aside>
          );
        })}
    </section>
  );
}
