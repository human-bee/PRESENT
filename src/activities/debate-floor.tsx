import type { CSSProperties } from 'react';
import type { Activity } from '../../shared/activity';
import type { Send } from './activity-api';
import { ClaimCard } from './claim-card';
import { Visuals } from './visuals';
import { DataComparison } from './data-comparison';
const colors = ['#ff987c', '#b0b7ff', '#a8d9b6', '#f4cf7c', '#ecafd3', '#89d1d7'];
export function DebateFloor({
  activity: a,
  selfId,
  name,
  send,
}: {
  activity: Activity;
  selfId: string;
  name: string;
  send: Send;
}) {
  const seat = a.seats.find((s) => s.actor === selfId);
  return (
    <section className="debate-floor">
      <div className="versus-intro">
        <span className="versus-stamp">{a.kind === 'debate' ? 'VS' : '↔'}</span>
        <div>
          <h2>{a.kind === 'debate' ? 'A little friction. A better idea.' : 'Follow the interesting thread.'}</h2>
          <p>
            {a.kind === 'debate'
              ? 'Make a case. Change your mind. Bring your whole perspective.'
              : 'Thoughts, questions, images and evidence find their place as you talk.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void send({ type: 'side', name: `Perspective ${a.sides.length + 1}` })}
          disabled={a.sides.length >= 6}
        >
          + Another perspective
        </button>
      </div>
      <div className="debate-perspectives" style={{ '--side-count': a.sides.length } as CSSProperties}>
        {a.sides.map((side, index) => {
          const observations = a.observations.filter((o) => o.sideId === side.id && o.kind !== 'uncertainty');
          const members = a.seats.filter((s) => s.sideId === side.id);
          return (
            <section
              className="perspective"
              key={side.id}
              style={{ '--side-color': colors[side.color % colors.length] } as CSSProperties}
              aria-label={`${side.name} side`}
            >
              <header className="perspective-heading">
                <span className="perspective-number">0{index + 1}</span>
                <input
                  aria-label={`Side ${index + 1} name`}
                  defaultValue={side.name}
                  key={side.name}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== side.name)
                      void send({ type: 'side', sideId: side.id, name: e.target.value });
                  }}
                />
                <button
                  type="button"
                  aria-pressed={seat?.sideId === side.id}
                  onClick={() => void send({ type: 'seat', sideId: side.id, name })}
                >
                  {seat?.sideId === side.id ? 'Your side ✓' : 'Take a seat'}
                </button>
              </header>
              <div className="perspective-people">
                {members.map((s) => (
                  <span key={s.actor}>
                    <i>{s.name.slice(0, 1)}</i>
                    {s.name}
                  </span>
                ))}
                {!members.length && <small>A perspective waiting for its people</small>}
              </div>
              <Visuals activity={a} sideId={side.id} />
              {!a.visuals.some((v) => v.sideId === side.id) && (
                <div className="perspective-invitation">
                  <span>{index % 2 ? '✴' : '✺'}</span>
                  <p>
                    {observations.length ? 'Finding the shape of this thought.' : 'Start anywhere.'}
                    <small>Images and evidence arrive with the conversation.</small>
                  </p>
                </div>
              )}
              <div className="perspective-thoughts">
                {observations.slice(-3).map((o) => (
                  <article className={`ambient-thought ${o.kind}`} key={o.id}>
                    <small>
                      {o.kind === 'preference' ? 'A POINT OF VIEW' : 'A GOOD QUESTION'} ·{' '}
                      {a.seats.find((s) => s.actor === o.source.actor)?.name ?? 'Speaker unknown'}
                    </small>
                    <p>{o.text}</p>
                    <details>
                      <summary>Original words</summary>
                      <q>{o.source.quote}</q>
                    </details>
                  </article>
                ))}
                {a.claims
                  .filter((c) => c.sideId === side.id)
                  .map((c) => (
                    <ClaimCard key={c.id} claim={c} activity={a} send={send} />
                  ))}
              </div>
            </section>
          );
        })}
      </div>
      {a.observations
        .filter((o) => o.kind === 'uncertainty')
        .slice(-2)
        .map((o) => (
          <aside className="context-question" key={o.id}>
            <span>?</span>
            <p>{o.text}</p>
            <small>Keep talking to clarify.</small>
          </aside>
        ))}
      {a.observations.some((o) => !o.sideId && o.kind !== 'uncertainty') && (
        <section className="activity-unattributed">
          <h3>On the open floor</h3>
          <div>
            {a.observations
              .filter((o) => !o.sideId && o.kind !== 'uncertainty')
              .map((o) => (
                <article className="ambient-thought" key={o.id}>
                  <small>
                    {a.seats.find((s) => s.actor === o.source.actor)?.name ?? 'Speaker unknown'} · {o.kind}
                  </small>
                  <p>{o.text}</p>
                  <details>
                    <summary>Original words</summary>
                    <q>{o.source.quote}</q>
                  </details>
                </article>
              ))}
          </div>
        </section>
      )}
      {a.claims.some((c) => !c.sideId) && (
        <section className="activity-unattributed">
          <h3>Shared questions</h3>
          <div>
            {a.claims
              .filter((c) => !c.sideId)
              .map((c) => (
                <ClaimCard key={c.id} claim={c} activity={a} send={send} />
              ))}
          </div>
        </section>
      )}
      <DataComparison activity={a} send={send} />
    </section>
  );
}
