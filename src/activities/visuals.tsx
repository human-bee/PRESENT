import type { Activity } from '../../shared/activity';
import { SourceLink } from './source-link';
export function Visuals({ activity, sideId }: { activity: Activity; sideId: string | null }) {
  return (
    <div className="activity-visuals">
      {activity.visuals
        .filter((v) => v.sideId === sideId)
        .map((v) => (
          <section key={v.id}>
            <h4>{v.query}</h4>
            {v.status === 'pending' ? (
              <p>Finding sourced images…</p>
            ) : v.error ? (
              <p>{v.error}</p>
            ) : (
              v.images.map((image) => (
                <figure key={image.url}>
                  <img src={image.url} alt={image.title} referrerPolicy="no-referrer" loading="lazy" />
                  <figcaption>
                    <SourceLink url={image.sourceUrl}>{image.title}</SourceLink>
                    <small>
                      {image.attribution} · {image.license}
                    </small>
                  </figcaption>
                </figure>
              ))
            )}
          </section>
        ))}
    </div>
  );
}
