import { safeEvidenceUrl } from '../../shared/evidence';
export function SourceLink({ url, children }: { url: string; children: React.ReactNode }) {
  const safe = safeEvidenceUrl(url);
  return safe ? (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  ) : (
    <span>{children}</span>
  );
}
