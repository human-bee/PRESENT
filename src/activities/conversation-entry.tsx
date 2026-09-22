import { useState } from 'react';
import type { Activity, Utterance } from '../../shared/activity';
import type { Send } from './activity-api';
import { SideSelect } from './side-select';
export function ConversationEntry({
  utterance: u,
  activity: a,
  send,
}: {
  utterance: Utterance;
  activity: Activity;
  send: Send;
}) {
  const [correcting, setCorrecting] = useState(false);
  return (
    <article className="conversation-entry">
      <div>
        <strong>{u.speakerName}</strong>
        <small>
          {u.source === 'room-voice' ? 'room audio' : 'typed'} ·{' '}
          {a.sides.find((s) => s.id === u.sideId)?.name ?? 'open floor'}
        </small>
      </div>
      <p>{u.text}</p>
      <footer>
        <span>
          {u.extraction === 'running' || u.extraction === 'pending'
            ? '✦ Finding checkable claims…'
            : u.extraction === 'done'
              ? `Claims considered · ${((u.elapsedMs ?? 0) / 1000).toFixed(1)}s`
              : (u.error ?? 'Auto extraction paused')}
        </span>
        <button type="button" onClick={() => setCorrecting(!correcting)}>
          Attribute
        </button>
        <button
          type="button"
          onClick={() =>
            void send({
              type: 'claim',
              text: u.text,
              utteranceId: u.id,
              sideId: u.sideId,
            })
          }
        >
          Capture claim
        </button>
        {(u.extraction === 'failed' || u.extraction === 'off') && (
          <button type="button" onClick={() => void send({ type: 'extract', utteranceId: u.id })}>
            Extract claims
          </button>
        )}
      </footer>
      {correcting && (
        <form
          className="activity-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void send({
              type: 'attribute',
              utteranceId: u.id,
              speakerId: String(data.get('speaker')) || null,
              sideId: String(data.get('side')) || null,
            }).then((ok) => {
              if (ok) setCorrecting(false);
            });
          }}
        >
          <label>
            Speaker
            <select name="speaker" defaultValue={u.speakerId ?? ''}>
              <option value="">Unattributed</option>
              {a.seats.map((s) => (
                <option key={s.actor} value={s.actor}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <SideSelect activity={a} name="side" defaultValue={u.sideId ?? ''} />
          <button type="submit">Save attribution</button>
        </form>
      )}
    </article>
  );
}
