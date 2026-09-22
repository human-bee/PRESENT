import type { ReactNode } from 'react';
import type { Activity } from '../../shared/activity';
import type { AudienceComment } from '../../shared/audience';
import type { Send } from './activity-api';
export function AudienceInbox({
  a,
  host,
  send,
  source,
}: {
  a: Activity;
  host: boolean;
  send: Send;
  source: (c: AudienceComment) => ReactNode;
}) {
  return (
    <section className="audience-inbox">
      <header>
        <h3>Incoming</h3>
        <span>Host review</span>
      </header>
      {a.audience.comments
        .filter((c) => c.status === 'pending')
        .slice(-24)
        .reverse()
        .map((c) => (
          <article key={c.id}>
            <p>{c.text}</p>
            {source(c)}
            {host && (
              <div>
                <button
                  type="button"
                  onClick={() =>
                    void send({
                      type: 'audience-moderate',
                      commentId: c.id,
                      status: 'approved',
                      reason: 'Approved for the next-up queue',
                    })
                  }
                >
                  Add to next up
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void send({
                      type: 'audience-moderate',
                      commentId: c.id,
                      status: 'rejected',
                      reason: 'Host declined this suggestion',
                    })
                  }
                >
                  Dismiss
                </button>
                <button type="button" onClick={() => void send({ type: 'audience-block', commentId: c.id })}>
                  Block author
                </button>
              </div>
            )}
          </article>
        ))}
      {!a.audience.comments.some((c) => c.status === 'pending') && (
        <p className="meeting-empty">No comments waiting for review.</p>
      )}
      <details className="audience-history">
        <summary>
          Finished and moderated · {a.audience.comments.filter((c) => ['done', 'rejected'].includes(c.status)).length}
        </summary>
        {a.audience.comments
          .filter((c) => ['done', 'rejected'].includes(c.status))
          .map((c) => (
            <article key={c.id}>
              <p>{c.text}</p>
              {source(c)}
              <small>
                {c.status} · {c.moderationReason}
              </small>
            </article>
          ))}
      </details>
    </section>
  );
}
