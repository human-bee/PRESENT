import type { Activity } from '../../shared/activity';
import { safeEvidenceUrl } from '../../shared/evidence';
import { SourceLink } from './source-link';
export function PersonCard({
  a,
  seat,
  index,
  selfId,
  onConnect,
  onEdit,
}: {
  a: Activity;
  seat: Activity['seats'][number];
  index: number;
  selfId: string;
  onConnect: () => void;
  onEdit: () => void;
}) {
  const profile = a.meeting.members.find((p) => p.actor === seat.actor),
    owned = a.meeting.commitments.filter((c) => c.ownerId === seat.actor);
  const portrait = profile?.avatarUrl && safeEvidenceUrl(profile.avatarUrl);
  const strengths = profile?.personalStrengths.length
    ? profile.personalStrengths
    : profile?.source === 'self-described'
      ? profile.strengths
      : [];
  return (
    <article
      className={`person-introduction person-tone-${index % 3}`}
      key={seat.actor}
      aria-label={`${seat.name} introduction`}
    >
      <div className="person-card-top">
        <span>PERSON / {String(index + 1).padStart(2, '0')}</span>
        <span>{seat.actor === selfId ? 'YOU' : 'PARTICIPANT'} ✴</span>
      </div>
      <div className="person-portrait">
        {portrait ? (
          <img src={portrait} alt={profile.name} referrerPolicy="no-referrer" />
        ) : (
          <span>{seat.name.slice(0, 1)}</span>
        )}
        <i>✦</i>
      </div>
      <h3>{seat.name}</h3>
      {profile?.name && profile.name !== seat.name && <small className="person-alias">Work profile connected</small>}
      <p className="person-team">{profile?.team || 'A fresh perspective in the room'}</p>
      {profile?.about && <p className="person-about">{profile.about}</p>}
      <div className="person-projects">
        <small>IN THEIR ORBIT</small>
        {profile?.projects.length ? (
          profile.projects.map((project) => <span key={project}>↗ {project}</span>)
        ) : (
          <p>Current projects will appear when they connect their work.</p>
        )}
      </div>
      {strengths.length > 0 && (
        <div className="person-strengths">
          <small>WHAT I BRING · PERSON-SUPPLIED</small>
          {strengths.map((strength) => (
            <span key={strength}>{strength}</span>
          ))}
        </div>
      )}
      {profile?.source === 'linear' && profile.strengths.length > 0 && (
        <details className="person-work-themes">
          <summary>Work themes from Linear</summary>
          <p>{profile.strengths.join(' · ')}</p>
          <small>Labels on assigned work, not demonstrated skill ratings.</small>
        </details>
      )}
      <div className="person-agent">
        <span className="agent-companion">✦</span>
        <div>
          <strong>
            {owned.length
              ? `${owned.length} commitment${owned.length === 1 ? '' : 's'} under their care`
              : 'Room to make a move'}
          </strong>
          <small>{owned.filter((c) => c.jobId).length} Codex workspaces · human ownership stays here</small>
        </div>
      </div>
      {owned.slice(-2).map((c) => (
        <button
          type="button"
          className="person-owned-work"
          key={c.id}
          disabled={!c.objectId}
          aria-label={`Open ${c.title} work`}
          onClick={() =>
            window.dispatchEvent(new CustomEvent('present:open-work', { detail: { objectId: c.objectId } }))
          }
        >
          <span>{c.title}</span>
          <strong>{c.status}</strong>
        </button>
      ))}
      {profile?.sourceUrl && (
        <div className="person-source">
          <SourceLink url={profile.sourceUrl}>
            {profile.source === 'linear' ? 'Work context from Linear' : 'Person-supplied source'}
          </SourceLink>
        </div>
      )}
      {profile?.status === 'pending' && <p className="person-loading">✦ Bringing in the work trail…</p>}
      {profile?.error && <p className="person-error">{profile.error}</p>}
      {seat.actor === selfId && (
        <footer>
          <button type="button" onClick={onConnect}>
            {profile?.source === 'linear' ? 'Review linked profile' : 'Connect my work ↗'}
          </button>
          <button type="button" onClick={onEdit}>
            Add my introduction
          </button>
        </footer>
      )}
    </article>
  );
}
