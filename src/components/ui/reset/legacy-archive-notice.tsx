import Link from 'next/link';

type LegacyArchiveNoticeProps = {
  eyebrow: string;
  title: string;
  summary: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  detail?: string;
};

export function LegacyArchiveNotice({
  eyebrow,
  title,
  summary,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  detail,
}: LegacyArchiveNoticeProps) {
  return (
    <main className="legacy-archive">
      <div className="legacy-archive__panel">
        <div className="legacy-archive__eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{summary}</p>
        {detail ? <p className="legacy-archive__detail">{detail}</p> : null}
        <div className="legacy-archive__actions">
          <Link href={primaryHref} className="legacy-archive__button">
            {primaryLabel}
          </Link>
          {secondaryHref && secondaryLabel ? (
            <Link href={secondaryHref} className="legacy-archive__button legacy-archive__button--secondary">
              {secondaryLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}
