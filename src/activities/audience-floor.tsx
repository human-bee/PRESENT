import { AudienceConnector } from './audience-connector';
import { AudienceInbox } from './audience-inbox';
import { useState } from 'react';
import { audienceQueue, type AudienceComment } from '../../shared/audience';
import type { Activity, ActivityCommand } from '../../shared/activity';
import { safeEvidenceUrl } from '../../shared/evidence';
type Send = (command: ActivityCommand) => Promise<boolean>;
export function AudienceFloor({
  activity: a,
  selfId,
  name,
  roomId,
  send,
  viewer = false,
}: {
  activity: Activity;
  selfId: string;
  name: string;
  roomId: string;
  send: Send;
  viewer?: boolean;
}) {
  const [draft, setDraft] = useState(''),
    [copied, setCopied] = useState(false);
  const host = selfId === a.createdBy,
    queue = audienceQueue(a.audience),
    live = a.audience.comments.find((c) => c.status === 'live');
  const source = (c: AudienceComment) => (
    <span className="audience-source">
      {c.source === 'fixture' ? 'TEST FIXTURE' : c.source === 'youtube' ? 'YouTube' : 'Room audience'} · {c.authorName}
      {c.sourceUrl && safeEvidenceUrl(c.sourceUrl) && (
        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
          {' '}
          source ↗
        </a>
      )}
    </span>
  );
  return (
    <section className="audience-floor">
      <header className="audience-intro">
        <div>
          <span className="activity-eyebrow">THE NEXT GOOD IDEA COULD COME FROM ANYONE</span>
          <h2>{viewer ? 'You’re part of the show.' : 'Let the room steer the show.'}</h2>
          <p>
            {a.audience.comments.length} retained comments · {queue.length} approved ideas · {a.audience.omitted}{' '}
            earlier comments trimmed
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const url = new URL(`/r/${roomId}`, location.origin);
            url.searchParams.set('audience', a.id);
            void navigator.clipboard.writeText(url.href).then(() => setCopied(true));
          }}
        >
          {copied ? 'Audience link copied ✓' : 'Copy audience link ↗'}
        </button>
      </header>
      <div className="audience-onair">
        <span className="onair-badge">● ON AIR</span>
        <h3>{live?.text ?? 'The stage is yours.'}</h3>
        {live ? source(live) : <p>Approve an idea and bring it on air when you’re ready.</p>}
        {host && live && (
          <button
            type="button"
            onClick={() =>
              void send({
                type: 'audience-moderate',
                commentId: live.id,
                status: 'done',
                reason: 'Host completed this segment',
              })
            }
          >
            Finish this segment ✓
          </button>
        )}
      </div>
      <div className="audience-columns">
        <section>
          <header>
            <h3>Next up</h3>
            <span>Audience votes help set the order</span>
          </header>
          {queue.length === 0 && <p className="meeting-empty">Approved suggestions will gather here.</p>}
          {queue.map((c, index) => (
            <article className="audience-queue-card" key={c.id}>
              <span className="queue-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <span className="audience-category">{c.category}</span>
                <p>{c.text}</p>
                {source(c)}
              </div>
              <div className="queue-actions">
                <button
                  type="button"
                  aria-pressed={c.votes.includes(selfId)}
                  disabled={c.votes.includes(selfId)}
                  onClick={() => void send({ type: 'audience-vote', commentId: c.id })}
                >
                  ↑ {c.votes.length}
                </button>
                {host && (
                  <button
                    type="button"
                    onClick={() =>
                      void send({
                        type: 'audience-moderate',
                        commentId: c.id,
                        status: 'live',
                        reason: 'Host selected this audience suggestion',
                      })
                    }
                  >
                    Bring on air ↗
                  </button>
                )}
              </div>
            </article>
          ))}
          <form
            className="audience-submit"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void send({
                type: 'audience-comment',
                name: String(data.get('name')),
                category: String(data.get('category')) as AudienceComment['category'],
                text: draft,
              }).then((ok) => {
                if (ok) setDraft('');
              });
            }}
          >
            <h3>What should happen next?</h3>
            <div>
              <label>
                Display name
                <input name="name" defaultValue={name} required maxLength={100} />
              </label>
              <label>
                Suggestion type
                <select name="category">
                  <option value="topic">Topic</option>
                  <option value="game">Game</option>
                  <option value="question">Question</option>
                  <option value="other">Something else</option>
                </select>
              </label>
            </div>
            <label>
              Your suggestion
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={1500}
                required
                rows={3}
                placeholder="Try this next…"
              />
            </label>
            <button type="submit" disabled={!draft.trim()}>
              Send to the host ↗
            </button>
            <small>Suggestions are visible in this room and need host approval before joining the queue.</small>
          </form>
        </section>
        {!viewer && <AudienceInbox a={a} host={host} send={send} source={source} />}
      </div>
      {!viewer && <AudienceConnector a={a} host={host} send={send} />}
    </section>
  );
}
