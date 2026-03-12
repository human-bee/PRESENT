import type { BenchmarkManifestView } from '@/app/admin/agents/benchmarks/benchmark-data';

const formatPct = (value: number | null) =>
  value === null ? 'n/a' : `${Math.round(value * 100)}%`;
const formatScore = (value: number | null) => (value === null ? 'n/a' : value.toFixed(1));
const formatMs = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value)} ms`);

export function BenchmarkSummary({ manifest }: { manifest: BenchmarkManifestView }) {
  const cards = [
    { label: 'Suite', value: manifest.suiteId },
    {
      label: 'Generated',
      value: manifest.generatedAt ? new Date(manifest.generatedAt).toLocaleString() : 'n/a',
    },
    {
      label: 'Run Coverage',
      value: `${manifest.summary.completedRuns}/${manifest.summary.totalRuns}`,
    },
    { label: 'Pass Rate', value: formatPct(manifest.summary.passRate) },
    { label: 'Average Score', value: formatScore(manifest.summary.averageScore) },
    { label: 'Fastest TTFB', value: formatMs(manifest.summary.fastestTtfbMs) },
  ];

  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      {cards.map((card, index) => (
        <article
          key={card.label}
          className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0d1420] p-5 shadow-[0_24px_50px_rgba(0,0,0,0.25)]"
        >
          <div
            className="absolute inset-x-0 top-0 h-1"
            style={{
              background: index % 3 === 0 ? '#f97316' : index % 3 === 1 ? '#14b8a6' : '#facc15',
            }}
          />
          <p className="text-[11px] uppercase tracking-[0.3em] text-[#c5b6a4]">{card.label}</p>
          <p
            className="mt-4 text-2xl text-[#fff7ed]"
            style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
          >
            {card.value}
          </p>
        </article>
      ))}
    </section>
  );
}
