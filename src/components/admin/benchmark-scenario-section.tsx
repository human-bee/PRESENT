import type {
  BenchmarkRunView,
  BenchmarkScenarioView,
  BenchmarkVariantView,
} from '@/app/admin/agents/benchmarks/benchmark-data';
import { BenchmarkRunCard } from './benchmark-run-card';

export function BenchmarkScenarioSection({
  scenario,
  variants,
  runs,
}: {
  scenario: BenchmarkScenarioView;
  variants: BenchmarkVariantView[];
  runs: BenchmarkRunView[];
}) {
  const runMap = new Map(runs.map((run) => [run.variantId, run]));

  return (
    <section className="rounded-[2.25rem] border border-white/10 bg-[linear-gradient(180deg,_rgba(17,24,39,0.9),_rgba(8,12,18,0.96))] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.28)] sm:p-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.35em] text-[#14b8a6]">
            {scenario.category ?? 'Scenario'}
          </p>
          <h2
            className="mt-3 text-3xl text-[#fff7ed]"
            style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
          >
            {scenario.label}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[#d7c8b6]">
            {scenario.description ??
              'No scenario description was embedded in the latest benchmark manifest.'}
          </p>
        </div>
        <div className="rounded-[1.4rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#efe2d2]">
          {runs.length} captured attempt{runs.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {variants.map((variant) => (
          <BenchmarkRunCard
            key={`${scenario.id}-${variant.id}`}
            run={runMap.get(variant.id) ?? null}
            variant={variant}
          />
        ))}
      </div>
    </section>
  );
}
