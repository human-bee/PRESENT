import { useState } from 'react';
import type { Activity } from '../../shared/activity';
import type { Send } from './activity-api';
import { useWorkJobs } from './use-work-jobs';
export function CommitmentBoard({
  activity: a,
  selfId,
  roomId,
  send,
}: {
  activity: Activity;
  selfId: string;
  roomId: string;
  send: Send;
}) {
  const [adding, setAdding] = useState(false),
    jobs = useWorkJobs(roomId, a);
  const member = (id: string) =>
    a.seats.find((s) => s.actor === id)?.name ?? a.meeting.members.find((p) => p.actor === id)?.name ?? 'Teammate';
  return (
    <section className="commitment-board">
      <header>
        <h2>Make the next move.</h2>
        <button type="button" onClick={() => setAdding(!adding)}>
          + Dependent work
        </button>
      </header>
      {adding && (
        <form
          className="activity-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            void send({
              type: 'commitment',
              title: String(d.get('title')),
              prompt: String(d.get('prompt')),
              ownerId: String(d.get('owner')),
              blockedBy: d.getAll('blockedBy').map(String),
            }).then((ok) => {
              if (ok) setAdding(false);
            });
          }}
        >
          <label>
            Deliverable title
            <input name="title" required maxLength={180} />
          </label>
          <label>
            Human owner
            <select name="owner" defaultValue={selfId}>
              {a.seats.map((s) => (
                <option key={s.actor} value={s.actor}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="meeting-wide">
            Exact work for Codex
            <textarea name="prompt" required maxLength={4000} />
          </label>
          <fieldset className="meeting-wide">
            <legend>After these blockers clear</legend>
            {a.meeting.blockers.map((b) => (
              <label key={b.id}>
                <input type="checkbox" name="blockedBy" value={b.id} />
                {b.title}
              </label>
            ))}
          </fieldset>
          <button type="submit">Prepare commitment</button>
        </form>
      )}
      {a.meeting.commitments.map((c) => {
        const job = c.jobId ? jobs[c.jobId] : null;
        return (
          <article className="commitment-card" key={c.id}>
            <div>
              <span>✦ {job?.status ?? c.status}</span>
              <small>{member(c.ownerId)} owns this</small>
            </div>
            <h3>{c.title}</h3>
            <details className="work-brief">
              <summary>The brief</summary>
              <p>{c.prompt}</p>
            </details>
            <ul>
              {c.blockedBy.map((id) => {
                const b = a.meeting.blockers.find((b) => b.id === id);
                return (
                  <li key={id}>
                    {b?.status === 'resolved' ? '✓' : '○'} {b?.title ?? 'Missing blocker'}
                  </li>
                );
              })}
            </ul>
            {c.authorizedBy && <small>Automatic start authorized by {member(c.authorizedBy)}</small>}
            {c.ownerId === selfId && !c.jobId && (
              <div className="commitment-actions">
                {c.authorizedBy ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void send({ type: 'cancel-authorization', commitmentId: c.id })}
                    >
                      Revoke automatic start
                    </button>
                    {c.status === 'failed' && (
                      <button type="button" onClick={() => void send({ type: 'retry-dispatch', commitmentId: c.id })}>
                        Retry dispatch
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      Codex can begin this exact brief in its private workspace when the owners confirm the blockers are
                      resolved.
                    </p>
                    <button type="button" onClick={() => void send({ type: 'authorize-work', commitmentId: c.id })}>
                      Authorize automatic start
                    </button>
                  </>
                )}
              </div>
            )}
            {c.jobId && (
              <div className="meeting-execution">
                <strong>✦ Spark · {job?.status ?? c.status}</strong>
                <div className="work-file-list">
                  {job?.execution?.files.map((f) => (
                    <span key={f.path}>↳ {f.path}</span>
                  ))}
                </div>
                <details>
                  <summary>Execution receipts</summary>
                  {job?.execution?.commands.map((command) => (
                    <p key={command.id}>
                      <code>{command.command}</code> · exit {command.exitCode ?? 'pending'}
                    </p>
                  ))}
                </details>
                {c.objectId && (
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent('present:open-work', { detail: { objectId: c.objectId } }))
                    }
                  >
                    Open work & oversight ↗
                  </button>
                )}
              </div>
            )}
            {(c.error || job?.error) && <p className="claim-error">{c.error || job?.error}</p>}
          </article>
        );
      })}
      {!a.meeting.commitments.length && (
        <p className="meeting-empty">
          Define the useful next piece of work. Its human owner stays in charge while Codex follows through.
        </p>
      )}
    </section>
  );
}
