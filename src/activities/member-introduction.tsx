import { PersonCard } from './person-card';
import { useEffect, useState } from 'react';
import type { Activity } from '../../shared/activity';
import type { Send } from './activity-api';
import { SourceLink } from './source-link';

export function MemberIntroductions({ activity: a, selfId, send }: { activity: Activity; selfId: string; send: Send }) {
  const [editing, setEditing] = useState(false),
    [connection, setConnection] = useState(false);
  const [viewer, setViewer] = useState<{ name: string; team: string; avatarUrl: string; sourceUrl: string } | null>(
      null,
    ),
    [problem, setProblem] = useState('');
  const own = a.meeting.members.find((p) => p.actor === selfId);
  const featured = a.seats
    .filter(
      (s) =>
        s.actor === selfId ||
        a.meeting.members.some((p) => p.actor === s.actor) ||
        a.meeting.commitments.some((c) => c.ownerId === s.actor),
    )
    .sort(
      (x, y) =>
        (a.meeting.members.find((p) => p.actor === y.actor)?.fetchedAt ?? 0) -
        (a.meeting.members.find((p) => p.actor === x.actor)?.fetchedAt ?? 0),
    );
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    fetch('/api/activity/linear-viewer')
      .then(async (r) => {
        const value = await r.json();
        if (!r.ok) throw new Error(value.error);
        if (!cancelled) setViewer(value);
      })
      .catch((e) => {
        if (!cancelled) setProblem(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);
  return (
    <section className="member-introductions" aria-label="People and their work">
      <div className="introduction-heading">
        <span>YOUR PEOPLE, IN THEIR ELEMENT</span>
        <h2>Good to have you here.</h2>
        <p>Get to know the person. See what they’re moving forward.</p>
      </div>
      <div className="people-chips">
        {a.seats.map((s) => (
          <span key={s.actor}>{s.name}</span>
        ))}
      </div>
      <div className="people-deck">
        {featured.map((seat, index) => (
          <PersonCard
            key={seat.actor}
            a={a}
            seat={seat}
            index={index}
            selfId={selfId}
            onConnect={() => {
              setConnection(true);
              setProblem('');
            }}
            onEdit={() => setEditing(!editing)}
          />
        ))}
      </div>
      {connection && (
        <section className="profile-connection" aria-label="Connect your work">
          <button type="button" className="panel-close" onClick={() => setConnection(false)}>
            Close
          </button>
          <h3>Bring your work into the room.</h3>
          {viewer ? (
            <>
              <p>
                The connected Linear account is <strong>{viewer.name}</strong> in {viewer.team}.
              </p>
              <button
                type="button"
                onClick={() =>
                  void send({ type: 'profile-self' }).then((ok) => {
                    if (ok) setConnection(false);
                  })
                }
              >
                This is my profile — connect it
              </button>
              <small>
                Associate it only if it is yours. Seeing a profile through this connection does not establish someone
                else’s account access.
              </small>
            </>
          ) : (
            <p>{problem || 'Checking the connected account…'}</p>
          )}
          <details>
            <summary>Someone else, or missing access?</summary>
            <p>
              A workspace administrator needs to confirm that person’s membership and project access. You can prepare
              the local onboarding blocker now; no invitation or membership change is sent.
            </p>
            <button
              type="button"
              onClick={() =>
                void send({
                  type: 'blocker',
                  title: 'Confirm my Linear identity, team membership and project access',
                  ownerId: selfId,
                })
              }
            >
              Prepare my access checklist
            </button>
            <SourceLink url="https://linear.app/settings/api">Review Linear connection settings</SourceLink>
          </details>
        </section>
      )}
      {editing && (
        <form
          className="person-introduction-editor"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget),
              strengths = String(data.get('strengths'))
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 8);
            const command = own
              ? { type: 'profile-strengths' as const, strengths, about: String(data.get('about')) }
              : {
                  type: 'profile' as const,
                  profile: {
                    name: a.seats.find((s) => s.actor === selfId)?.name ?? 'Participant',
                    team: String(data.get('team')),
                    projects: String(data.get('projects'))
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                    strengths,
                    sourceUrl: '',
                  },
                };
            void send(command).then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        >
          <h3>A little about you.</h3>
          <label>
            What you bring
            <input
              name="strengths"
              placeholder="Facilitation, prototyping, testing…"
              defaultValue={own?.personalStrengths.join(', ')}
              maxLength={800}
            />
          </label>
          <label>
            A short introduction
            <textarea name="about" defaultValue={own?.about} maxLength={300} />
          </label>
          {!own && (
            <>
              <label>
                Your team
                <input name="team" maxLength={160} />
              </label>
              <label>
                Your projects
                <input name="projects" maxLength={800} />
              </label>
            </>
          )}
          <small>Your own description stays distinct from work-derived context.</small>
          <button type="submit">Share my introduction</button>
        </form>
      )}
    </section>
  );
}
