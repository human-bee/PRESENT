'use client';

import { useEffect, useState } from 'react';
import type { BenchmarkManifestView } from '@/app/admin/agents/benchmarks/benchmark-data';
import { fetchWithSupabaseAuth } from '@/lib/supabase/auth-headers';
import { BenchmarkExplorer } from './benchmark-explorer';
import { BenchmarkShell } from './benchmark-shell';
import { BenchmarkSummary } from './benchmark-summary';

type BenchmarkPageState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: BenchmarkManifestView | null }
  | { status: 'unauthorized'; error: string }
  | { status: 'forbidden'; error: string }
  | { status: 'error'; error: string };

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.clone().json()) as { error?: unknown };
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {}
  const text = await response.text().catch(() => '');
  return text || `Request failed (${response.status})`;
};

export function BenchmarkPageClient() {
  const [state, setState] = useState<BenchmarkPageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetchWithSupabaseAuth('/api/admin/agents/benchmarks/manifest', {
          cache: 'no-store',
        });

        if (!response.ok) {
          const error = await readErrorMessage(response);
          if (cancelled) return;
          if (response.status === 401) {
            setState({ status: 'unauthorized', error });
            return;
          }
          if (response.status === 403) {
            setState({ status: 'forbidden', error });
            return;
          }
          setState({ status: 'error', error });
          return;
        }

        const payload = (await response.json()) as { manifest?: BenchmarkManifestView | null };
        if (!cancelled) {
          setState({ status: 'ready', manifest: payload.manifest ?? null });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <BenchmarkShell
        eyebrow="Canvas Benchmarking"
        title="Loading benchmark manifest."
        subtitle="Fetching the latest canvas benchmark suite through the authenticated admin API."
      >
        <section className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm leading-7 text-[#dccfbe]">
          Waiting for the benchmark manifest, screenshots, and operator metadata.
        </section>
      </BenchmarkShell>
    );
  }

  if (state.status === 'unauthorized' || state.status === 'forbidden') {
    const title =
      state.status === 'unauthorized'
        ? 'Benchmark access requires sign-in.'
        : 'Benchmark access is restricted.';
    const subtitle =
      state.status === 'unauthorized'
        ? 'Sign in with an allowed account to inspect benchmark screenshots, artifacts, and cost data.'
        : 'This benchmark surface follows the same allowlist and open-access policy as the rest of agent admin.';

    return (
      <BenchmarkShell eyebrow="Canvas Benchmarking" title={title} subtitle={subtitle}>
        <section className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm leading-7 text-[#dccfbe]">
          Access check failed with <span className="font-mono text-[#fff7ed]">{state.error}</span>.
        </section>
      </BenchmarkShell>
    );
  }

  if (state.status === 'error') {
    return (
      <BenchmarkShell
        eyebrow="Canvas Benchmarking"
        title="Benchmark manifest could not be loaded."
        subtitle="The benchmark surface found a manifest path, but the manifest could not be parsed or read safely."
      >
        <section className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm leading-7 text-[#dccfbe]">
          Load error: <span className="font-mono text-[#fff7ed]">{state.error}</span>
        </section>
      </BenchmarkShell>
    );
  }

  if (!state.manifest) {
    return (
      <BenchmarkShell
        eyebrow="Canvas Benchmarking"
        title="No benchmark manifest found yet."
        subtitle="The admin comparison surface is wired, but `docs/benchmarks/canvas-agent/latest.json` has not been generated in this worktree."
      >
        <section className="rounded-[2rem] border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm leading-7 text-[#dccfbe]">
          Generate a suite run, then refresh this page. The reader expects a manifest at
          `docs/benchmarks/canvas-agent/latest.json` and screenshot artifacts under
          `docs/benchmarks/canvas-agent/`.
        </section>
      </BenchmarkShell>
    );
  }

  return (
    <BenchmarkShell
      eyebrow="Canvas Benchmarking"
      title="PRESENT fairy and canvas benchmarks, rendered as an operator surface."
      subtitle="Scenario-by-scenario comparison of visual output, latency, followup churn, and failure texture across model variants."
    >
      <div className="space-y-8">
        <BenchmarkSummary manifest={state.manifest} />
        <BenchmarkExplorer manifest={state.manifest} />
        <section className="rounded-[1.8rem] border border-white/10 bg-[#0c1420] px-6 py-5 text-sm text-[#d6c9ba]">
          Manifest source: <span className="font-mono text-[#fff7ed]">{state.manifest.sourcePath}</span>
        </section>
      </div>
    </BenchmarkShell>
  );
}
