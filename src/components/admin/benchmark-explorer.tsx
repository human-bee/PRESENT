'use client';

import { useMemo, useState } from 'react';
import type {
  BenchmarkManifestView,
  BenchmarkRunView,
} from '@/app/admin/agents/benchmarks/benchmark-data';
import { BenchmarkScenarioSection } from './benchmark-scenario-section';

const LAYOUT_ACTIONS = new Set([
  'align',
  'distribute',
  'stack',
  'reorder',
  'move',
  'resize',
  'rotate',
  'group',
  'ungroup',
  'place',
  'set_viewport',
]);

const formatMs = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value)} ms`);
const formatUsd = (value: number | null) => (value === null ? 'n/a' : `$${value.toFixed(4)}`);

const countByKey = (record: Record<string, number>, keys: string[]) =>
  keys.reduce((total, key) => total + (record[key] ?? 0), 0);

const summarizeOther = (record: Record<string, number>, excluded: string[]) =>
  Object.entries(record).reduce(
    (total, [key, value]) => (excluded.includes(key) ? total : total + value),
    0,
  );

const matchesQuery = (run: BenchmarkRunView, scenarioLabel: string, variantLabel: string, query: string) => {
  const haystack = [
    scenarioLabel,
    variantLabel,
    run.status,
    run.comparisonLabel ?? '',
    run.visualAnalysis.summary ?? '',
    run.visualAnalysis.scoreRationale ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
};

export function BenchmarkExplorer({ manifest }: { manifest: BenchmarkManifestView }) {
  const [view, setView] = useState<'board' | 'table'>('board');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed'>('all');
  const [variantFilter, setVariantFilter] = useState('all');
  const [scenarioFilter, setScenarioFilter] = useState('all');

  const scenarioMap = useMemo(
    () => new Map(manifest.scenarios.map((scenario) => [scenario.id, scenario])),
    [manifest.scenarios],
  );
  const variantMap = useMemo(
    () => new Map(manifest.variants.map((variant) => [variant.id, variant])),
    [manifest.variants],
  );

  const filteredRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return manifest.runs.filter((run) => {
      if (statusFilter !== 'all' && run.status !== statusFilter) return false;
      if (variantFilter !== 'all' && run.variantId !== variantFilter) return false;
      if (scenarioFilter !== 'all' && run.scenarioId !== scenarioFilter) return false;
      if (!normalizedQuery) return true;
      const scenarioLabel = scenarioMap.get(run.scenarioId)?.label ?? run.scenarioId;
      const variantLabel = variantMap.get(run.variantId)?.label ?? run.variantId;
      return matchesQuery(run, scenarioLabel, variantLabel, normalizedQuery);
    });
  }, [manifest.runs, query, scenarioFilter, scenarioMap, statusFilter, variantFilter, variantMap]);

  const filteredScenarios = manifest.scenarios.filter((scenario) =>
    filteredRuns.some((run) => run.scenarioId === scenario.id),
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-white/10 bg-[#0b121d] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-[#f59e0b]">Views</p>
            <h2
              className="mt-3 text-3xl text-[#fff7ed]"
              style={{ fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}
            >
              Board and table slices of the same suite.
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[#d7c8b6]">
              Filter by scenario, model, status, or query. The board keeps the visual comparison
              intact; the table exposes the tunable metrics and action or shape mix.
            </p>
          </div>
          <div className="flex gap-3">
            {(['board', 'table'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={`rounded-full px-4 py-2 text-sm uppercase tracking-[0.25em] transition ${
                  view === option
                    ? 'bg-[#f59e0b] text-[#120f0b]'
                    : 'border border-white/10 bg-white/5 text-[#f7e7d4]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1.2fr_repeat(3,minmax(0,0.8fr))]">
          <label className="rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-4 py-3">
            <span className="text-[10px] uppercase tracking-[0.3em] text-[#bba894]">Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="multi-fairy, failed, hero, sketch..."
              className="mt-2 w-full bg-transparent text-sm text-[#fff7ed] outline-none placeholder:text-[#8f8275]"
            />
          </label>
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              ['all', 'All statuses'],
              ['completed', 'Completed'],
              ['failed', 'Failed'],
            ]}
          />
          <FilterSelect
            label="Variant"
            value={variantFilter}
            onChange={setVariantFilter}
            options={[
              ['all', 'All variants'],
              ...manifest.variants.map((variant) => [variant.id, variant.label] as const),
            ]}
          />
          <FilterSelect
            label="Scenario"
            value={scenarioFilter}
            onChange={setScenarioFilter}
            options={[
              ['all', 'All scenarios'],
              ...manifest.scenarios.map((scenario) => [scenario.id, scenario.label] as const),
            ]}
          />
        </div>
      </section>

      {view === 'board' ? (
        filteredScenarios.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-8">
            {filteredScenarios.map((scenario) => (
              <BenchmarkScenarioSection
                key={scenario.id}
                scenario={scenario}
                variants={manifest.variants}
                runs={filteredRuns.filter((run) => run.scenarioId === scenario.id)}
              />
            ))}
          </div>
        )
      ) : (
        filteredRuns.length === 0 ? (
          <EmptyState />
        ) : (
          <BenchmarkTable
            runs={filteredRuns}
            scenarioMap={scenarioMap}
            variantMap={variantMap}
          />
        )
      )}
    </div>
  );
}

function FilterSelect<TValue extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<readonly [TValue, string]>;
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <label className="rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-4 py-3">
      <span className="text-[10px] uppercase tracking-[0.3em] text-[#bba894]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TValue)}
        className="mt-2 w-full bg-transparent text-sm text-[#fff7ed] outline-none"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue} className="bg-[#0b121d] text-[#fff7ed]">
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function BenchmarkTable({
  runs,
  scenarioMap,
  variantMap,
}: {
  runs: BenchmarkRunView[];
  scenarioMap: Map<string, BenchmarkManifestView['scenarios'][number]>;
  variantMap: Map<string, BenchmarkManifestView['variants'][number]>;
}) {
  const sorted = [...runs].sort((left, right) => {
    const scenarioCompare = (scenarioMap.get(left.scenarioId)?.label ?? left.scenarioId).localeCompare(
      scenarioMap.get(right.scenarioId)?.label ?? right.scenarioId,
    );
    if (scenarioCompare !== 0) return scenarioCompare;
    return (variantMap.get(left.variantId)?.label ?? left.variantId).localeCompare(
      variantMap.get(right.variantId)?.label ?? right.variantId,
    );
  });

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#09101a] shadow-[0_24px_60px_rgba(0,0,0,0.3)]">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-[#efe2d2]">
          <thead className="sticky top-0 bg-[#101826] text-[11px] uppercase tracking-[0.25em] text-[#baa894]">
            <tr>
              <th rowSpan={2} className="border-b border-white/10 px-4 py-4">Scenario</th>
              <th rowSpan={2} className="border-b border-white/10 px-4 py-4">Variant</th>
              <th rowSpan={2} className="border-b border-white/10 px-4 py-4">Status</th>
              <th rowSpan={2} className="border-b border-white/10 px-4 py-4">Score</th>
              <th colSpan={4} className="border-b border-white/10 px-4 py-4 text-center">Latency and Spend</th>
              <th colSpan={4} className="border-b border-white/10 px-4 py-4 text-center">Action Verbs</th>
              <th colSpan={6} className="border-b border-white/10 px-4 py-4 text-center">Final Shapes</th>
              <th rowSpan={2} className="border-b border-white/10 px-4 py-4">Visual Analysis</th>
            </tr>
            <tr>
              <th className="border-b border-white/10 px-4 py-3">TTFB</th>
              <th className="border-b border-white/10 px-4 py-3">Total</th>
              <th className="border-b border-white/10 px-4 py-3">Tokens</th>
              <th className="border-b border-white/10 px-4 py-3">Cost</th>
              <th className="border-b border-white/10 px-4 py-3">Create</th>
              <th className="border-b border-white/10 px-4 py-3">Update</th>
              <th className="border-b border-white/10 px-4 py-3">Layout</th>
              <th className="border-b border-white/10 px-4 py-3">Other</th>
              <th className="border-b border-white/10 px-4 py-3">Note</th>
              <th className="border-b border-white/10 px-4 py-3">Draw</th>
              <th className="border-b border-white/10 px-4 py-3">Box</th>
              <th className="border-b border-white/10 px-4 py-3">Text</th>
              <th className="border-b border-white/10 px-4 py-3">Arrow</th>
              <th className="border-b border-white/10 px-4 py-3">Other</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((run) => {
              const actions = run.actionSummary.byName;
              const shapes = run.shapeSummary.byName;
              const createCount = actions.create_shape ?? 0;
              const updateCount = actions.update_shape ?? 0;
              const layoutCount = countByKey(actions, Array.from(LAYOUT_ACTIONS));
              const otherActionCount = Math.max(
                0,
                (run.actionSummary.total ?? 0) - createCount - updateCount - layoutCount,
              );
              const otherShapeCount = summarizeOther(shapes, ['note', 'draw', 'box', 'text', 'arrow']);

              return (
                <tr key={run.id} className="align-top even:bg-white/[0.02]">
                  <td className="border-b border-white/6 px-4 py-4">
                    <div className="min-w-[220px]">
                      <p className="font-medium text-[#fff7ed]">
                        {scenarioMap.get(run.scenarioId)?.label ?? run.scenarioId}
                      </p>
                      <p className="mt-1 text-xs text-[#aa9b89]">{run.comparisonLabel ?? run.scenarioId}</p>
                    </div>
                  </td>
                  <td className="border-b border-white/6 px-4 py-4">
                    {variantMap.get(run.variantId)?.label ?? run.variantId}
                  </td>
                  <td className="border-b border-white/6 px-4 py-4">{run.status}</td>
                  <td className="border-b border-white/6 px-4 py-4">
                    {run.score === null ? 'n/a' : run.score.toFixed(1)}
                  </td>
                  <td className="border-b border-white/6 px-4 py-4">{formatMs(run.metrics.ttfbMs)}</td>
                  <td className="border-b border-white/6 px-4 py-4">{formatMs(run.metrics.totalMs)}</td>
                  <td className="border-b border-white/6 px-4 py-4">
                    {run.metrics.totalTokens === null ? 'n/a' : run.metrics.totalTokens.toLocaleString()}
                  </td>
                  <td className="border-b border-white/6 px-4 py-4">{formatUsd(run.metrics.costUsd)}</td>
                  <td className="border-b border-white/6 px-4 py-4">{createCount}</td>
                  <td className="border-b border-white/6 px-4 py-4">{updateCount}</td>
                  <td className="border-b border-white/6 px-4 py-4">{layoutCount}</td>
                  <td className="border-b border-white/6 px-4 py-4">{otherActionCount}</td>
                  <td className="border-b border-white/6 px-4 py-4">{shapes.note ?? 0}</td>
                  <td className="border-b border-white/6 px-4 py-4">{shapes.draw ?? 0}</td>
                  <td className="border-b border-white/6 px-4 py-4">{shapes.box ?? 0}</td>
                  <td className="border-b border-white/6 px-4 py-4">{shapes.text ?? 0}</td>
                  <td className="border-b border-white/6 px-4 py-4">{shapes.arrow ?? 0}</td>
                  <td className="border-b border-white/6 px-4 py-4">{otherShapeCount}</td>
                  <td className="border-b border-white/6 px-4 py-4">
                    <div className="min-w-[280px]">
                      <p className="font-medium text-[#fff7ed]">
                        {run.visualAnalysis.summary ?? 'No visual analysis yet.'}
                      </p>
                      {run.visualAnalysis.scoreRationale ? (
                        <p className="mt-1 text-xs leading-5 text-[#bcae9c]">
                          {run.visualAnalysis.scoreRationale}
                        </p>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="rounded-[2rem] border border-dashed border-white/10 bg-[#0b121d] px-6 py-10 text-center text-sm leading-7 text-[#d7c8b6]">
      No runs matched the current filters. Clear one or more filters to bring the suite back into view.
    </section>
  );
}
