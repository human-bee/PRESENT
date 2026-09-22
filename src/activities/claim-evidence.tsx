import type { EvidenceReport } from '../../shared/evidence';
import { safeEvidenceUrl } from '../../shared/evidence';
import { escapeEvidenceHtml, renderEvidenceMarkdown } from '../../shared/evidence-markdown';
import { SourceLink } from './source-link';
export function Evidence({ report, stale }: { report: EvidenceReport; stale?: boolean }) {
  const text = report.modelAssessment.text;
  const marks = new Map<number, string[]>();
  for (const citation of report.modelAssessment.citations)
    marks.set(citation.endIndex, [...new Set([...(marks.get(citation.endIndex) ?? []), citation.sourceId])]);
  const citationMarks = [...marks].map(([endIndex, ids]) => ({
    endIndex,
    html:
      '<sup>' +
      ids
        .flatMap((id) => {
          const source = report.sources.find((s) => s.id === id);
          const url = safeEvidenceUrl(source?.url);
          return source && url
            ? [
                `<a href="${escapeEvidenceHtml(url)}" target="_blank" rel="noopener noreferrer">[${escapeEvidenceHtml(id)}]</a>`,
              ]
            : [];
        })
        .join(' ') +
      '</sup>',
  }));
  const markup = renderEvidenceMarkdown(text, citationMarks, safeEvidenceUrl);
  return (
    <section className="claim-evidence">
      <p className="evidence-boundary">
        {stale ? 'Earlier wording — research again for this version.' : 'Model assessment · inspect the sources'}
      </p>
      <div
        className="evidence-text"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: The shared evidence renderer escapes all source text and validates every URL.
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      <ul>
        {report.sources.map((source) => (
          <li key={source.id}>
            <SourceLink url={source.url}>
              {source.id}. {source.title}
            </SourceLink>
          </li>
        ))}
      </ul>
      <small>
        {report.model} · {new Date(report.retrievedAt).toLocaleTimeString()} ·{' '}
        {report.coverage === 'no-citable-sources'
          ? 'No citable sources returned'
          : `${report.sources.length} cited sources`}
      </small>
    </section>
  );
}
