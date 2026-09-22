import type { Send } from './activity-api';
import type { Activity } from '../../shared/activity';
import { evidenceReportSchema } from '../../shared/evidence';
import { SourceLink } from './source-link';
import { Evidence } from './claim-evidence';
export function DataComparison({ activity: a, send }: { activity: Activity; send: Send }) {
  return (
    <section className="ambient-comparisons" aria-label="Contextual comparisons">
      {a.comparisons
        .filter((c) => c.dataQuestion)
        .map((c) => {
          const chart = a.charts.find((chart) => chart.id === c.chartId),
            evidence = evidenceReportSchema.safeParse(c.evidence);
          const min = Math.min(0, ...(chart?.values.map((v) => v.value) ?? [])),
            max = Math.max(1, ...(chart?.values.map((v) => v.value) ?? [])),
            extent = max - min;
          return (
            <article className="ambient-data-card" key={c.id}>
              <header>
                <span>IN PERSPECTIVE</span>
                <h3>{chart?.title ?? c.title}</h3>
                <small>
                  {c.status === 'pending' || c.status === 'running'
                    ? 'Reading the original source numbers…'
                    : chart
                      ? 'Numbers traced to original sources'
                      : 'An open question'}
                </small>
              </header>
              {chart && (
                <figure className="activity-chart">
                  <figcaption>
                    {chart.unit} · {chart.scope}
                  </figcaption>
                  {chart.values.map((v) => (
                    <div className="chart-row" key={v.label}>
                      <span>{v.label}</span>
                      <div>
                        <i
                          style={{
                            width: `${(Math.abs(v.value) / extent) * 100}%`,
                            marginLeft: `${((Math.min(0, v.value) - min) / extent) * 100}%`,
                          }}
                        />
                      </div>
                      <b>{v.value}</b>
                    </div>
                  ))}
                  <ul className="chart-caveats">
                    {chart.caveats.map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  </ul>
                  <details>
                    <summary>Trace these numbers</summary>
                    {chart.sourceRows.map((row) => (
                      <p key={`${row.sourceId}-${row.label}`}>
                        <strong>{row.label}</strong>
                        {row.cohort && <span> · {row.cohort}</span>}
                        <q>{row.quote}</q>
                        <SourceLink url={row.sourceUrl}>Original source</SourceLink>
                      </p>
                    ))}
                  </details>
                </figure>
              )}
              {['uncertain', 'failed'].includes(c.status) && (
                <button type="button" onClick={() => void send({ type: 'comparison-retry', comparisonId: c.id })}>
                  Check sources again
                </button>
              )}
              {c.error && <p className="comparison-uncertainty">{c.error}</p>}
              {evidence.success && (
                <details className="comparison-evidence">
                  <summary>What the evidence says</summary>
                  <Evidence report={evidence.data} />
                </details>
              )}
              <small className="ambient-source-quote">
                From {a.seats.find((s) => s.actor === c.source.actor)?.name ?? 'the conversation'}: “{c.source.quote}”
              </small>
            </article>
          );
        })}
    </section>
  );
}
