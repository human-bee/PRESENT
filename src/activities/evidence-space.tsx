import { useState } from 'react';
import type { Activity } from '../../shared/activity';
import type { Send } from './activity-api';
import { SideSelect } from './side-select';
import { Visuals } from './visuals';
import { Evidence } from './claim-evidence';
import { SourceLink } from './source-link';
export function EvidenceSpace({ activity: a, send }: { activity: Activity; send: Send }) {
  const [chartOpen, setChartOpen] = useState(false),
    [chartError, setChartError] = useState('');
  return (
    <section className="evidence-space">
      <header>
        <h2>Bring something to the table.</h2>
        <p>Sources for the argument. Images for the imagination. Data with its context.</p>
      </header>
      <form
        className="visual-search"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const form = event.currentTarget;
          void send({
            type: 'visual',
            query: String(data.get('query')),
            sideId: String(data.get('side')) || null,
          }).then((ok) => {
            if (ok) form.reset();
          });
        }}
      >
        <label>
          Find a visual
          <input name="query" placeholder="Truss bridge, red Ferrari…" maxLength={160} required />
        </label>
        <SideSelect activity={a} name="side" label="Place it with" />
        <button type="submit">Find images ↗</button>
      </form>
      <div className="evidence-comparisons">
        {[...a.sides.map((s) => ({ id: s.id as string | null, name: s.name })), { id: null, name: 'Open floor' }].map(
          (side) => (
            <section key={side.id ?? 'floor'}>
              <h3>{side.name}</h3>
              <Visuals activity={a} sideId={side.id} />
              {a.claims
                .filter((c) => c.sideId === side.id && c.evidence)
                .map((c) => (
                  <div className="evidence-claim" key={c.id}>
                    <h4>{c.text}</h4>
                    {c.evidence && <Evidence report={c.evidence} stale={c.evidence.question !== c.text} />}
                  </div>
                ))}
            </section>
          ),
        )}
      </div>
      <div className="activity-data">
        <h3>Put numbers in perspective.</h3>
        <p>Use a cited dataset. Keep units and scope visible.</p>
        <button type="button" onClick={() => setChartOpen(!chartOpen)}>
          + Add sourced data
        </button>
        {chartOpen && (
          <form
            className="activity-chart-form"
            onSubmit={(event) => {
              event.preventDefault();
              setChartError('');
              const data = new FormData(event.currentTarget);
              const lines = String(data.get('values'))
                .split('\n')
                .filter((l) => l.trim());
              const values = lines.map((line) => {
                const split = line.lastIndexOf(',');
                return {
                  label: line.slice(0, split).trim(),
                  value: Number(line.slice(split + 1).trim()),
                };
              });
              if (
                values.length < 2 ||
                values.length > 8 ||
                values.some((v) => !v.label || !Number.isFinite(v.value)) ||
                lines.some((l) => !l.includes(',') || !l.split(',').at(-1)?.trim())
              ) {
                setChartError('Use 2–8 rows, each with a label and a finite number separated by a comma.');
                return;
              }
              void send({
                type: 'chart',
                chart: {
                  title: String(data.get('title')),
                  unit: String(data.get('unit')),
                  sourceUrl: String(data.get('sourceUrl')),
                  sourceTitle: String(data.get('sourceTitle')),
                  values,
                },
              }).then((ok) => {
                if (ok) setChartOpen(false);
              });
            }}
          >
            <label>
              Chart title
              <input name="title" required maxLength={120} />
            </label>
            <label>
              Unit
              <input name="unit" required maxLength={40} />
            </label>
            <label>
              Source title
              <input name="sourceTitle" required maxLength={160} />
            </label>
            <label>
              Source URL
              <input name="sourceUrl" required type="url" />
            </label>
            <label>
              Data, one label and value per line
              <textarea name="values" placeholder={'Group A, 12\nGroup B, 18'} required />
            </label>
            <small>Values are participant supplied; attaching a source does not verify the transcription.</small>
            {chartError && <p role="alert">{chartError}</p>}
            <button type="submit">Add comparison</button>
          </form>
        )}
        {a.charts.map((chart) => {
          const min = Math.min(0, ...chart.values.map((v) => v.value)),
            max = Math.max(0, ...chart.values.map((v) => v.value)),
            extent = Math.max(1, max - min);
          return (
            <figure className="activity-chart" key={chart.id}>
              <figcaption>
                <strong>{chart.title}</strong> · {chart.unit}
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
              <SourceLink url={chart.sourceUrl}>{chart.sourceTitle}</SourceLink>
              <small>
                Participant supplied data · {a.seats.find((s) => s.actor === chart.suppliedBy)?.name ?? 'Participant'}
              </small>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
